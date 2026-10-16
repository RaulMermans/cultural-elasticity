/**
 * Property / invariant tests over seeded random SYNTHETIC methodology inputs (deterministic PRNG, no
 * property-testing dependency). A reach test guards against vacuous properties.
 */
import type { CulturalElasticityResult, RobustnessLevel } from "@cultural-elasticity/shared";
import { describe, expect, it } from "vitest";
import type { MethodologyInputRaw } from "../src/methodology/contracts.js";
import { analyzeElasticity } from "../src/methodology/elasticity.js";
import { indexTransform } from "../src/methodology/relative-index.js";
import { ROBUSTNESS_ORDER } from "../src/methodology/robustness.js";
import { clone, synInput, type SynPanel } from "./fixtures/synthetic/methodology.js";

const RUNS = 120;

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
type Rng = ReturnType<typeof mulberry32>;
const int = (rng: Rng, max: number) => Math.floor(rng() * (max + 1));
function shuffle<T>(rng: Rng, items: readonly T[]): T[] {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = int(rng, i);
    [copy[i], copy[j]] = [copy[j] as T, copy[i] as T];
  }
  return copy;
}

const TAG_POOL = ["keyword:qloo", "lifestyle:qloo", "credit_card:place", "genre:place", "specialty_dish:place", "genre:media"].flatMap((ns) => [0, 1, 2].map((n) => ({ ns, name: `${ns.split(":")[0]}-${n}` })));

function randomInput(rng: Rng): MethodologyInputRaw {
  const territories = Array.from({ length: 2 + int(rng, 4) }, (_, i) => `t${i + 1}`);
  const exemplars = Object.fromEntries(territories.map((t) => [t, 1 + int(rng, 2)]));
  const panelCount = 1 + int(rng, 2);
  const panels: SynPanel[] = Array.from({ length: panelCount }, (_, i) => ({ id: String.fromCharCode(65 + i), exemplarIndex: i, order: shuffle(rng, territories), values: territories.map(() => rng()) }));
  if (rng() < 0.6) panels.push({ id: "R", purpose: "repeat", repeatOf: "A", exemplarIndex: 0, order: rng() < 0.8 ? panels[0]!.order : shuffle(rng, territories) });
  const pickTags = () => shuffle(rng, TAG_POOL).slice(0, 2 + int(rng, 8));
  const conditioned = Object.fromEntries(territories.map((t) => [t, rng() < 0.2 ? undefined : int(rng, 8)]));
  const input = synInput({ territories, exemplars, panels, brandTags: pickTags(), exemplarTags: () => pickTags(), conditioned });
  return input;
}

const forEachInput = (fn: (input: MethodologyInputRaw, rng: Rng, run: number) => void) => {
  for (let run = 0; run < RUNS; run += 1) {
    const rng = mulberry32(1000 + run);
    fn(randomInput(rng), rng, run);
  }
};
const strip = (r: CulturalElasticityResult) => JSON.parse(JSON.stringify(r, (k, v) => (k === "withinCallValue" ? null : v)));
const rank = (level: RobustnessLevel) => ROBUSTNESS_ORDER.indexOf(level);

describe("methodology invariants", () => {
  it("generator reaches the interesting cases (not vacuous)", () => {
    const seen = new Set<string>();
    forEachInput((input) => {
      const r = analyzeElasticity(input);
      for (const t of r.territories) seen.add(t.robustness.level).add(t.classification.label);
      seen.add(`gate-${r.indexGate.status}`);
    });
    for (const expected of ["HIGH", "MEDIUM", "LOW", "INSUFFICIENT", "NATURAL_ADJACENCY", "CREDIBLE_STRETCH", "CULTURAL_BREAK", "UNCERTAIN_REPRESENTATION_SENSITIVE", "gate-PASS", "gate-FAIL"]) expect(seen, expected).toContain(expected);
  });

  it("same input + same version = same output", () => {
    forEachInput((input) => expect(JSON.stringify(analyzeElasticity(clone(input)))).toBe(JSON.stringify(analyzeElasticity(clone(input)))));
  });

  it("changing raw value magnitudes while preserving same-call order does not change rank-only aggregation", () => {
    forEachInput((input, rng) => {
      const rescaled = clone(input);
      for (const panel of rescaled.panels) {
        const factor = 1 + rng() * 1000;
        const offset = rng() * 50 - 25;
        for (const c of panel.ranking?.candidates ?? []) if (c.numeric) c.numeric = { ...c.numeric, value: c.numeric.value * factor + offset };
      }
      expect(strip(analyzeElasticity(rescaled))).toEqual(strip(analyzeElasticity(input)));
    });
  });

  it("reordering input arrays does not alter the result when explicit ranks are preserved", () => {
    forEachInput((input, rng) => {
      const shuffled = clone(input);
      shuffled.territories = shuffle(rng, shuffled.territories);
      shuffled.panels = shuffle(rng, shuffled.panels).map((p) => ({ ...p, assignments: shuffle(rng, p.assignments), ...(p.ranking && { ranking: { ...p.ranking, candidates: shuffle(rng, p.ranking.candidates) } }) }));
      shuffled.exemplarProfiles = shuffle(rng, shuffled.exemplarProfiles);
      shuffled.conditioned = shuffle(rng, shuffled.conditioned).map((c) => ({ ...c, entities: shuffle(rng, c.entities) }));
      for (const t of shuffled.territories) {
        const [primary, ...rest] = t.exemplars;
        t.exemplars = [primary!, ...shuffle(rng, rest)];
      }
      expect(JSON.stringify(analyzeElasticity(shuffled))).toBe(JSON.stringify(analyzeElasticity(input)));
    });
  });

  it("replacing one panel's evidence may change robustness but never rewrites other panels' evidence", () => {
    forEachInput((input, rng) => {
      const aggregated = input.panels.filter((p) => p.purpose !== "repeat");
      if (aggregated.length < 2) return;
      const changed = clone(input);
      const target = changed.panels.find((p) => p.id === aggregated[aggregated.length - 1]!.id)!;
      const order = shuffle(rng, target.ranking!.candidates.map((c) => c.id));
      for (const c of target.ranking!.candidates) c.rank = order.indexOf(c.id) + 1;
      const before = analyzeElasticity(input);
      const after = analyzeElasticity(changed);
      for (const t of before.territories) {
        const other = after.territories.find((x) => x.territory.id === t.territory.id)!;
        expect(other.panelEvidence.filter((o) => o.panelId !== target.id)).toEqual(t.panelEvidence.filter((o) => o.panelId !== target.id));
      }
    });
  });

  it("removing an exemplar's evidence never improves representation robustness (or the index eligibility)", () => {
    forEachInput((input) => {
      const before = analyzeElasticity(input);
      for (const territory of input.territories) {
        for (const exemplar of territory.exemplars) {
          const removed = clone(input);
          for (const panel of removed.panels) if (panel.assignments.some((a) => a.exemplarId === exemplar.id)) delete panel.ranking;
          const after = analyzeElasticity(removed);
          const b = before.territories.find((t) => t.territory.id === territory.id)!;
          const a = after.territories.find((t) => t.territory.id === territory.id)!;
          expect(rank(a.robustness.level), `${territory.id} without ${exemplar.id}`).toBeLessThanOrEqual(rank(b.robustness.level));
        }
      }
    });
  });

  it("missing optional qualitative evidence never becomes a numeric zero", () => {
    forEachInput((input) => {
      for (const t of analyzeElasticity(input).territories) {
        if (t.conditionedEvidence === null) expect(t.limitations.some((l) => l.code === "CONDITIONED_NOT_COLLECTED")).toBe(true);
        for (const e of [...t.coherenceRaw.perExemplar, ...t.coherenceFiltered.perExemplar]) if (e.status === "unavailable") expect([e.sharedCount, e.jaccard, e.overlapCoefficient]).toEqual([null, null, null]);
        if (t.panelEvidence.length === 0) expect(t.relativePosition.medianPercentile).toBeNull();
      }
    });
  });

  it("filtered overlap never shares more than raw overlap, and every excluded tag stays inspectable", () => {
    forEachInput((input) => {
      const r = analyzeElasticity(input);
      expect(r.brandTagFilter.keptCount + r.brandTagFilter.excluded.length).toBe(r.brandTagFilter.rawCount);
      for (const t of r.territories) {
        for (const raw of t.coherenceRaw.perExemplar) {
          const f = t.coherenceFiltered.perExemplar.find((e) => e.exemplarId === raw.exemplarId)!;
          if (raw.sharedCount !== null && f.sharedCount !== null) expect(f.sharedCount).toBeLessThanOrEqual(raw.sharedCount);
        }
      }
    });
  });

  it("the candidate index transform is monotonic with the aggregated ordinal position", () => {
    forEachInput((input) => {
      const ts = analyzeElasticity(input).territories.filter((t) => t.relativePosition.medianPercentile !== null);
      for (const a of ts) for (const b of ts) if (a.relativePosition.medianPercentile! >= b.relativePosition.medianPercentile!) expect(indexTransform(a.relativePosition.medianPercentile!)).toBeGreaterThanOrEqual(indexTransform(b.relativePosition.medianPercentile!));
    });
  });

  it("positions agree with medians: a higher median never has a worse position", () => {
    forEachInput((input) => {
      const ts = analyzeElasticity(input).territories.filter((t) => t.relativePosition.position !== null);
      for (const a of ts) for (const b of ts) if (a.relativePosition.medianPercentile! > b.relativePosition.medianPercentile!) expect(a.relativePosition.position!).toBeLessThan(b.relativePosition.position!);
    });
  });
});
