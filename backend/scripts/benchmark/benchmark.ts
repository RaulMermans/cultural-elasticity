/**
 * Benchmark contract (evals/benchmarks/cultural-elasticity-v0/benchmark.json).
 *
 * Labels are HUMAN-CURATED EVALUATION LABELS, not objective truth. The primary test is pairwise:
 * "for brand X, territory A should rank above territory B" whenever A's label is stronger than B's.
 * The calibration / held-out split is by BRAND, so one brand never contributes cases to both sides.
 */
import { z } from "zod";

export const EXPECTATIONS = ["expected_strong", "expected_mid", "expected_weak"] as const;
export type Expectation = (typeof EXPECTATIONS)[number];
const STRENGTH: Record<Expectation, number> = { expected_strong: 2, expected_mid: 1, expected_weak: 0 };

const text = z.string().trim().min(1);

export const benchmarkSchema = z
  .strictObject({
    benchmarkVersion: text,
    notice: z.string().startsWith("HUMAN-CURATED EVALUATION LABELS"),
    labelProvenance: z.strictObject({ curator: text, recordedAt: z.iso.datetime({ offset: true }), method: text }),
    /** Owner review of the labels (Sprint 4). Label-dependent results are provisional until owner_reviewed is true. */
    ownerReview: z.strictObject({ owner_reviewed: z.boolean(), reviewedBy: text.nullable(), reviewedAt: z.iso.datetime({ offset: true }).nullable(), note: text }),
    labelScale: z.record(z.enum(EXPECTATIONS), text),
    split: z.strictObject({ unit: z.literal("brand"), rule: text, calibration: z.array(text).min(1), heldOut: z.array(text).min(1) }),
    territorySet: z.array(text).min(2),
    brands: z.array(
      z.strictObject({
        key: text,
        label: text,
        labelsWrittenBlind: z.boolean(),
        labels: z.array(z.strictObject({ territory: text, label: z.enum(EXPECTATIONS), rationale: text })),
      }),
    ),
  })
  .superRefine((benchmark, ctx) => {
    const keys = benchmark.brands.map((b) => b.key);
    const { calibration, heldOut } = benchmark.split;
    const overlap = calibration.filter((k) => heldOut.includes(k));
    if (overlap.length > 0) ctx.addIssue({ code: "custom", path: ["split"], message: `brand(s) in both subsets: ${overlap.join(", ")}` });
    const assigned = new Set([...calibration, ...heldOut]);
    for (const key of keys) if (!assigned.has(key)) ctx.addIssue({ code: "custom", path: ["split"], message: `brand "${key}" is in no subset` });
    for (const key of assigned) if (!keys.includes(key)) ctx.addIssue({ code: "custom", path: ["split"], message: `unknown brand "${key}"` });
    benchmark.brands.forEach((brand, b) => {
      if (heldOut.includes(brand.key) && !brand.labelsWrittenBlind) {
        ctx.addIssue({ code: "custom", path: ["brands", b, "labelsWrittenBlind"], message: "a brand whose labels were written after seeing its evidence cannot be held out" });
      }
      const territories = brand.labels.map((l) => l.territory).sort();
      if (JSON.stringify(territories) !== JSON.stringify([...benchmark.territorySet].sort())) {
        ctx.addIssue({ code: "custom", path: ["brands", b, "labels"], message: "labels must cover the territory set exactly once" });
      }
    });
  });
export type Benchmark = z.output<typeof benchmarkSchema>;

export type PairwiseAssertion = { brandKey: string; higher: string; lower: string; basis: `${Expectation}>${Expectation}` };

/** Every pair with different labels becomes "stronger label ranks above weaker label". */
export function pairwiseAssertions(benchmark: Benchmark): PairwiseAssertion[] {
  return benchmark.brands.flatMap((brand) =>
    brand.labels.flatMap((a) =>
      brand.labels
        .filter((b) => STRENGTH[a.label] > STRENGTH[b.label])
        .map((b) => ({ brandKey: brand.key, higher: a.territory, lower: b.territory, basis: `${a.label}>${b.label}` as const })),
    ),
  ).sort((x, y) => (x.brandKey + x.higher + x.lower < y.brandKey + y.higher + y.lower ? -1 : 1));
}

export function subsetOf(benchmark: Benchmark, brandKey: string): "calibration" | "heldOut" {
  if (benchmark.split.calibration.includes(brandKey)) return "calibration";
  if (benchmark.split.heldOut.includes(brandKey)) return "heldOut";
  throw new Error(`brand "${brandKey}" is in no subset`);
}

export function expectationOf(benchmark: Benchmark, brandKey: string, territoryId: string): Expectation | undefined {
  return benchmark.brands.find((b) => b.key === brandKey)?.labels.find((l) => l.territory === territoryId)?.label;
}
