import "server-only";
import { isBrandBaselineResult, type AnyBrandBaselineResult } from "@cultural-elasticity/shared";
import baselines from "@/demo/recorded-baselines.json";
import investigation from "@/demo/recorded-example.json";

/** A recorded research artifact bundled with the product. Opening one never calls a provider. */
export type RecordedBaseline = { key: string; recordedAt: string; note: string; result: AnyBrandBaselineResult };
export type RecordedEntry =
  | { kind: "baseline"; key: string; brand: string; recordedAt: string; connections: number; directions: number }
  | { kind: "investigation"; key: string; brand: string; recordedAt: string; question: string | null };

/** Only entries that pass the browser boundary guard are offered; an invalid artifact is left out, never patched. */
export function recordedBaselines(): RecordedBaseline[] {
  const items = (baselines as { items?: unknown[] }).items ?? [];
  return items.flatMap((item) => {
    const record = item as { key?: unknown; kind?: unknown; evidenceOrigin?: unknown; recordedAt?: unknown; note?: unknown; result?: unknown };
    if (record.kind !== "RECORDED_BASELINE" || record.evidenceOrigin !== "live" || typeof record.key !== "string" || typeof record.recordedAt !== "string" || !isBrandBaselineResult(record.result)) return [];
    return [{ key: record.key, recordedAt: record.recordedAt, note: typeof record.note === "string" ? record.note : "", result: record.result }];
  });
}

export function recordedCatalog(): RecordedEntry[] {
  const entries: RecordedEntry[] = recordedBaselines().map((item) => ({
    kind: "baseline",
    key: item.key,
    brand: item.result.brand.name,
    recordedAt: item.recordedAt,
    connections: item.result.fingerprint.signals.length,
    directions: item.result.territories.length,
  }));
  const first = investigation.responses[0] as { interpretation?: { rawQuery?: string } | null; investigation?: { result?: { brand?: { label?: string } } } | null } | undefined;
  const brand = first?.investigation?.result?.brand?.label;
  if (brand) entries.push({ kind: "investigation", key: "recorded-investigation", brand, recordedAt: investigation.recordedAt, question: first?.interpretation?.rawQuery ?? null });
  return entries;
}
