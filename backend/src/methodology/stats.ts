/** Small deterministic helpers. Rounding keeps threshold comparisons exact (0.8 + 0.6) / 2 = 0.7. */
import { DECIMALS } from "./config.js";

export function round(value: number): number {
  const factor = 10 ** DECIMALS;
  return Math.round(value * factor) / factor;
}

/** Median of a non-empty list (mean of the two middle values for even length), rounded. */
export function median(values: readonly number[]): number {
  if (values.length === 0) throw new RangeError("median of an empty list");
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return round(sorted.length % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2);
}

/** Rank percentile inside one panel: 1 = top, 0 = bottom. Needs at least two candidates. */
export function rankPercentile(rank: number, panelSize: number): number {
  if (panelSize < 2) throw new RangeError("a rank percentile needs at least two candidates");
  return round((panelSize - rank) / (panelSize - 1));
}

/** Kendall τ-a between two strict orders over the same items (no ties: ranks are unique per panel). */
export function kendallTau(orderA: readonly string[], orderB: readonly string[]): number | null {
  const common = orderA.filter((id) => orderB.includes(id));
  const n = common.length;
  if (n < 2) return null;
  const posA = new Map(orderA.map((id, i) => [id, i]));
  const posB = new Map(orderB.map((id, i) => [id, i]));
  let concordant = 0;
  let discordant = 0;
  for (let i = 0; i < n; i += 1) {
    for (let j = i + 1; j < n; j += 1) {
      const a = Math.sign(posA.get(common[i]!)! - posA.get(common[j]!)!);
      const b = Math.sign(posB.get(common[i]!)! - posB.get(common[j]!)!);
      if (a === b) concordant += 1;
      else discordant += 1;
    }
  }
  return round((concordant - discordant) / ((n * (n - 1)) / 2));
}

export function compareStrings(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
