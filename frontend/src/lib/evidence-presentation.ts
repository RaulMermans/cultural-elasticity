/**
 * Presentation-only mapping for methodology identifiers.
 * Canonical backend values are never mutated. Unknown codes get a generic fallback
 * and are never given a fabricated explanation.
 */

export type EvidenceTerm = {
  code: string;
  label: string;
  explanation: string;
  known: boolean;
};

const TERMS: Record<string, Omit<EvidenceTerm, "code" | "known">> = {
  NATURAL_ADJACENCY: {
    label: "Natural adjacency",
    explanation: "In this comparison, the territory sits close to the brand’s observed cultural neighbourhood.",
  },
  CREDIBLE_STRETCH: {
    label: "Credible stretch",
    explanation: "In this comparison, the territory is farther from the brand than a natural adjacency, with some shared cultural signal.",
  },
  UNCERTAIN_REPRESENTATION_SENSITIVE: {
    label: "Representation-sensitive interpretation",
    explanation: "This finding may depend on how the cultural territory is defined or which examples stand for it.",
  },
  CULTURAL_BREAK: {
    label: "Cultural break",
    explanation: "In this comparison, shared cultural signal with the brand is weak or absent.",
  },
  INSUFFICIENT_EVIDENCE: {
    label: "Insufficient evidence",
    explanation: "There was not enough observed cultural evidence to support this reading.",
  },
  FULL_RELATIVE_ANALYSIS: {
    label: "Full comparison within one set",
    explanation: "Territories were compared with one another from the same evidence call.",
  },
  PARTIAL_CULTURAL_ANALYSIS: {
    label: "Partial cultural reading",
    explanation: "Some cultural evidence was available, without a full comparison.",
  },
  DESCRIPTIVE_ANALYSIS: {
    label: "Descriptive reading",
    explanation: "The investigation could describe evidence, not place the territory in a comparison.",
  },
  CONDITIONED_NOT_COLLECTED: {
    label: "Brand-conditioned evidence was not collected",
    explanation: "A brand-specific look at this territory was not gathered. Absence is missing evidence, not a zero.",
  },
  CONDITIONED_EMPTY: {
    label: "Brand-conditioned look returned nothing",
    explanation: "A cultural-evidence query tied to this concept came back empty. That is an observed empty result, not a missing call.",
  },
  ROBUSTNESS_INSUFFICIENT: {
    label: "Representation is not robust enough to rely on",
    explanation: "The position may change depending on which examples stand for this territory.",
  },
  ROBUSTNESS_LOW: {
    label: "Representation is weakly supported",
    explanation: "The position depends on which examples stand for this territory.",
  },
  ROBUSTNESS_MEDIUM: {
    label: "Representation is moderately stable",
    explanation: "The position was checked against more than one example, with some remaining spread.",
  },
  ROBUSTNESS_HIGH: {
    label: "Representation held across examples",
    explanation: "The position stayed similar when examples for the territory were swapped.",
  },
  TERRITORY_APPROXIMATION: {
    label: "Territory representation is approximate",
    explanation: "The examples used for this territory are limited, so the reading is approximate.",
  },
  NOT_COLLECTED_BUDGET: {
    label: "Optional evidence was not collected",
    explanation: "The investigation reached its evidence-call budget before some optional evidence could be gathered.",
  },
  COMPARISON_SET_TOO_SMALL: {
    label: "The comparison set was too small",
    explanation: "There were not enough comparable territories to complete this reading.",
  },
  RELATIVE_TO_COMPARISON_SET: {
    label: "Readings hold only inside this comparison",
    explanation: "Positions and classes apply to the territories compared in this run, not as an absolute score.",
  },
  EVIDENCE_SUPPORTED_TERRITORY: {
    label: "Evidence supports a comparison",
    explanation: "A comparison could be made from the evidence. That is not a recommendation.",
  },
  PARTIAL_EVIDENCE: {
    label: "Partial evidence",
    explanation: "Some evidence is available, and the picture is not complete.",
  },
  UNSUPPORTED: {
    label: "No usable evidence",
    explanation: "The investigation ran, and no usable evidence was found.",
  },
  HYPOTHESIS_PENDING_VALIDATION: {
    label: "Hypothesis",
    explanation: "Proposed, and not yet validated against cultural evidence.",
  },
};

const LEVELS: Record<string, string> = {
  HIGH: "high",
  MEDIUM: "medium",
  LOW: "low",
  INSUFFICIENT: "insufficient",
  SPARSE: "sparse",
  SOME: "some",
  STRONG: "strong",
  EMPTY: "empty",
  AVAILABLE: "available",
  UNAVAILABLE: "unavailable",
};

const CODE = /\b[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+\b/gu;
const LEVEL = /\b(HIGH|MEDIUM|LOW|INSUFFICIENT|SPARSE|SOME|STRONG|EMPTY|AVAILABLE|UNAVAILABLE)\b/gu;
const KEY_PREFIX = /^[a-z][a-z0-9_]{2,}:\s+/u;

export function evidenceTerm(code: string): EvidenceTerm {
  const known = TERMS[code];
  if (known) return { code, known: true, ...known };
  return {
    code,
    known: false,
    label: "Recorded technical detail",
    explanation: "A methodology note was recorded. It is kept in technical details without a product interpretation.",
  };
}

export type PresentedEvidence = {
  display: string;
  codes: string[];
  unknownCodes: string[];
};

export function presentEvidenceText(raw: string): PresentedEvidence {
  const codes: string[] = [];
  const unknownCodes: string[] = [];
  let text = raw.trim();
  text = text.replace(KEY_PREFIX, "");
  text = rewriteKnownLine(text, codes, unknownCodes);
  text = text.replace(CODE, (match) => {
    const term = evidenceTerm(match);
    codes.push(match);
    if (!term.known) unknownCodes.push(match);
    return term.label;
  });
  text = text.replace(LEVEL, (match) => LEVELS[match] ?? match.toLowerCase());
  text = text.replace(/\burn:[a-z0-9][a-z0-9:_-]*/giu, "A recorded cultural tag:");
  text = text.replace(/\bexemplars\b/gu, "examples").replace(/\bexemplar\b/gu, "example");
  text = text.replace(/\s+/gu, " ").replace(/\s+([,.;:])/gu, "$1").trim();
  return { display: text, codes: unique(codes), unknownCodes: unique(unknownCodes) };
}

export function presentEvidenceLines(lines: readonly string[]): PresentedEvidence[] {
  return lines.map(presentEvidenceText);
}

function rewriteKnownLine(line: string, codes: string[], unknownCodes: string[]): string {
  const relative = line.match(/^Relative position (\d+) of (\d+) \(median panel percentile ([0-9.]+)\) within the comparison set (.+)\.?$/u);
  if (relative) {
    const set = relative[4]!.replace(/\.+$/u, "");
    return `In this comparison, this territory sat ${ordinal(Number(relative[1]))} of ${relative[2]} (median percentile ${relative[3]}) among ${set}.`;
  }
  const robustness = line.match(/^Representation robustness ([A-Z]+) \((.+)\)\.?$/u);
  if (robustness) {
    const level = LEVELS[robustness[1]!] ?? robustness[1]!.toLowerCase();
    return `How stable this reading is: ${level} (${robustness[2]}).`;
  }
  const provisional = line.match(/^Provisional class ([A-Z_]+), relative to this comparison set only\.?$/u);
  if (provisional) {
    const term = evidenceTerm(provisional[1]!);
    codes.push(provisional[1]!);
    if (!term.known) unknownCodes.push(provisional[1]!);
    return `Provisional reading: ${term.label}, relative to this comparison set only.`;
  }
  const signals = line.match(/^Shared cultural signals \(operational tags filtered\): median (.+) across (.+?)(?: \(([A-Z]+)\))?\.?$/u);
  if (signals) {
    const band = signals[3] ? ` (${LEVELS[signals[3]] ?? signals[3].toLowerCase()})` : "";
    return `Shared cultural signals, after operational tags were filtered: median ${signals[1]} across ${signals[2]}${band}.`;
  }
  const quality = line.match(/^Evidence quality ([A-Z]+)\.?$/u);
  if (quality) {
    return `Evidence quality: ${LEVELS[quality[1]!] ?? quality[1]!.toLowerCase()}.`;
  }
  const route = line.match(/^Analysis route: (.+)\.?$/u);
  if (route) return `How the evidence was read: ${route[1]}.`;
  return line;
}

function ordinal(value: number): string {
  const remainder = value % 100;
  if (remainder >= 11 && remainder <= 13) return `${value}th`;
  switch (value % 10) {
    case 1:
      return `${value}st`;
    case 2:
      return `${value}nd`;
    case 3:
      return `${value}rd`;
    default:
      return `${value}th`;
  }
}

function unique(values: readonly string[]): string[] {
  return [...new Set(values)];
}

const EMPTY_OBSERVATION = [
  "No separate record of observed cultural evidence was included for this territory.",
  "No separate record of observed cultural evidence was included.",
  "Territory-specific evidence is unavailable.",
  "No evidence record is available for this investigation.",
];

const EMPTY_CALCULATED = ["No calculated finding was recorded.", "Routes were calculated for the investigation. Open a territory to see its own route."];
const EMPTY_LIMITATION = ["No further limitation was recorded."];

export function isPlaceholderLine(line: string): boolean {
  return EMPTY_OBSERVATION.includes(line) || EMPTY_CALCULATED.includes(line) || EMPTY_LIMITATION.includes(line);
}

export type TerritoryFindingView = {
  statusLabel: string;
  observation: string;
  whyItMatters: string;
  limitations: string[];
  unresolved: string[];
  empty: boolean;
};

export function findingCopy(input: {
  kind: "brand" | "territory";
  tone: string;
  statusLabel: string;
  observed: readonly string[];
  calculated: readonly string[];
  unavailable: readonly string[];
}): TerritoryFindingView {
  const observed = presentEvidenceLines(input.observed.filter((line) => !isPlaceholderLine(line)));
  const calculated = presentEvidenceLines(input.calculated.filter((line) => !isPlaceholderLine(line)));
  const limitations = presentEvidenceLines(input.unavailable.filter((line) => !isPlaceholderLine(line)));
  const observation = pickObservation(input.kind, input.tone, observed, calculated);
  const empty = observation.empty;
  return {
    statusLabel: input.statusLabel.replace(/\.$/u, ""),
    observation: observation.text,
    whyItMatters: whyItMatters(input.kind, input.tone, [...observed, ...calculated]),
    limitations: limitations.map((line) => line.display),
    unresolved: empty ? [observation.text] : limitations.filter((line) => /not collected|approximate|empty|budget/iu.test(line.display)).map((line) => line.display),
    empty,
  };
}

function pickObservation(
  kind: "brand" | "territory",
  tone: string,
  observed: readonly PresentedEvidence[],
  calculated: readonly PresentedEvidence[],
): { text: string; empty: boolean } {
  if (kind === "brand") {
    if (tone === "incomplete") return { text: "The investigation stopped before every planned step was collected.", empty: true };
    if (tone === "interrupted" || tone === "failed") return { text: "The investigation ended before a territory finding was available.", empty: true };
    return { text: "Open a territory to read what the evidence supports.", empty: false };
  }
  const examples = observed.find((line) => /^Examples connected/u.test(line.display));
  if (examples) return { text: examples.display, empty: false };
  const concept = observed.find((line) => /^Concepts observed/u.test(line.display));
  if (concept) return { text: concept.display, empty: false };
  const position = calculated.find((line) => /sat \d|In this comparison/u.test(line.display));
  if (position) return { text: position.display, empty: false };
  if (observed[0]) return { text: observed[0].display, empty: false };
  if (tone === "unsupported") {
    return { text: "Insufficient evidence to establish a territory-specific connection.", empty: true };
  }
  if (tone === "incomplete" || tone === "interrupted" || tone === "failed") {
    return { text: "Further investigation is needed before drawing a conclusion.", empty: true };
  }
  if (calculated[0]) return { text: calculated[0].display, empty: false };
  return { text: "Insufficient evidence to establish a territory-specific connection.", empty: true };
}

function whyItMatters(kind: "brand" | "territory", tone: string, lines: readonly PresentedEvidence[]): string {
  if (kind === "brand") {
    return "This is the root of the investigation. Its place on the atlas is lineage, not a score.";
  }
  const sensitive = lines.some((line) => line.codes.includes("UNCERTAIN_REPRESENTATION_SENSITIVE") || /representation-sensitive/iu.test(line.display));
  if (tone === "supported") {
    return sensitive
      ? "A comparison could be made from observed cultural evidence in this investigation. The reading is representation-sensitive, so it may depend on how the territory is exemplified. This is not a recommendation."
      : "A comparison could be made from observed cultural evidence in this investigation. This is not a recommendation.";
  }
  if (tone === "partial") {
    return "Some cultural evidence was observed, but it is not enough for a full comparison. Partial evidence is not strong support.";
  }
  if (tone === "unsupported") {
    return "The investigation ran and did not find usable cultural evidence for this territory.";
  }
  if (tone === "incomplete" || tone === "interrupted" || tone === "failed") {
    return "The investigation stopped before enough evidence was collected. That is not the same as finding no evidence.";
  }
  if (tone === "hypothesis") {
    return "This concept was proposed and has not been validated against cultural evidence.";
  }
  return "Its place on the atlas is investigation lineage, not a score.";
}
