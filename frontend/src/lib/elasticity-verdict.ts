/**
 * A plain-language reading of one territory's deterministic elasticity result. It restates the class, the relative
 * position and the robustness the methodology computed; it adds no number and no judgment of its own.
 */
export type VerdictInput = { code: string; position: number | null; of: number | null; set: readonly string[]; robustness: string | null; brand: string };

const HEADLINE: Record<string, string> = {
  NATURAL_ADJACENCY: "A natural fit in this comparison: it sits close to the brand's observed taste.",
  CREDIBLE_STRETCH: "A credible stretch: further from the brand than a natural fit, with some shared taste.",
  UNCERTAIN_REPRESENTATION_SENSITIVE: "Not settled: the reading changes with the examples chosen to stand for this territory.",
  CULTURAL_BREAK: "A weak fit in this comparison: little shared taste with the brand.",
};

const NEXT: Record<string, string> = {
  UNCERTAIN_REPRESENTATION_SENSITIVE: "To firm it up, compare it with more territories of the same kind, or name example entities for it.",
  CULTURAL_BREAK: "It may still be worth testing with other examples before ruling it out.",
};

export function elasticityVerdict(input: VerdictInput): { headline: string; lines: string[] } {
  const lines: string[] = [];
  if (input.position != null && input.of) {
    const among = input.set.length ? ` among ${input.set.join(", ")}` : "";
    lines.push(input.of > 1
      ? `It ranked ${input.position} of ${input.of}${among} in Qloo's association with ${input.brand} (1 is the strongest). The rank holds only for this set.`
      : `It was the only territory ranked, so there is nothing to compare it with yet.`);
  }
  if (input.robustness === "LOW" || input.robustness === "INSUFFICIENT") lines.push("Robustness is low: different examples could change this ranking.");
  else if (input.robustness === "HIGH" || input.robustness === "MEDIUM") lines.push("The ranking held across the example sets that were tested.");
  const next = NEXT[input.code];
  if (next) lines.push(next);
  return { headline: HEADLINE[input.code] ?? "The methodology classified this territory; see its label above.", lines };
}
