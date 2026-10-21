/**
 * Claim validation for model-written synthesis. Runs before any synthesis is returned.
 *
 *   territories   every territory note names a territory of this run
 *   classes       class language ("credible stretch", …) only next to a territory whose deterministic
 *                 class is exactly that; never for a territory without a class
 *   levels        robustness / evidence-quality levels must match the territory's computed level
 *   numbers       every number must appear in the deterministic results; percentages are refused
 *   language      no success prediction, probability, guarantee, score, confidence, distance or path
 *   v2 (Sprint 4) commercial-success language; unsupported causal language; "robust/stable" wording
 *                 for a territory whose robustness is low, insufficient or unmeasured; named things
 *                 (multi-word proper names) that are not in the run's state (territories, concepts,
 *                 brand, exemplars, conditioned entities)
 *
 *   v3 (Sprint 5A) numbers are grounded per scope, not against one run-wide whitelist: a territory note may only
 *                 use numbers of THAT territory's result; a summary / follow-up sentence only numbers of the
 *                 territories it names, plus run-level counts (territories, routes, the comparison-set minimum).
 *                 Two false positives found in Sprint 4 live traces are fixed: "consistently shared signals"
 *                 (a coherence field) is no longer robustness wording, and a directly negated noun disclaimer
 *                 ("not a prediction", "no score") is not a claim. Grounded findings (validateFindings) tie
 *                 each claim to a territory, a claim type and the result fields that support it.
 *
 * A violation rejects the synthesis (one retry with feedback, then a deterministic template).
 */
import type { AgentTerritoryResult, ElasticityClass, GroundedFinding } from "@cultural-elasticity/shared";
import type { Synthesis } from "./contracts.js";
import { synthesisTerritoryView } from "./prompts.js";

const CLASS_PATTERNS: [ElasticityClass, RegExp][] = [
  ["NATURAL_ADJACENCY", /natural(?:ly)?[\s_-]+adjacen(?:cy|t)/iu],
  ["CREDIBLE_STRETCH", /credible[\s_-]+stretch/iu],
  ["CULTURAL_BREAK", /cultural[\s_-]+break/iu],
  ["UNCERTAIN_REPRESENTATION_SENSITIVE", /representation[\s_-]+sensitive|uncertain[\s_-]+representation/iu],
];

const ROBUSTNESS_PATTERNS = [/\b(high|medium|low|insufficient)\s+(?:representation\s+)?robustness\b/giu, /\brobustness\s+(?:is\s+|was\s+|of\s+|remains\s+|level\s+|:\s*)?(high|medium|low|insufficient)\b/giu];
const QUALITY_PATTERNS = [/\b(high|medium|low)\s+evidence\s+quality\b/giu, /\bevidence\s+quality\s+(?:is\s+|was\s+|of\s+|:\s*)?(high|medium|low)\b/giu];

export const FORBIDDEN_LANGUAGE: { pattern: RegExp; why: string }[] = [
  { pattern: /%/u, why: "percentages are not a supported quantity (no probability or share is computed)" },
  { pattern: /\b(chance|chances|probability|probable|probably|likelihood|likely|unlikely|odds)\b/iu, why: "probability language: nothing here is a probability" },
  { pattern: /\b(revenue|revenues|sales|profit|profits|profitable|profitability|market share|roi|return on investment|demand|conversion rate)\b/iu, why: "commercial-success language: Qloo evidence measures cultural affinity, not commercial outcomes" },
  { pattern: /\b(caus(?:e|es|ed|ing)|drives|driven by|leads to|led to|results in|resulted in|because of)\b/iu, why: "unsupported causal language: the evidence is associative" },
  { pattern: /\b(will|would)\s+(definitely|certainly|surely|undoubtedly)\b/iu, why: "certainty claim" },
  { pattern: /\bguarantee[sd]?\b/iu, why: "guarantee claim" },
  { pattern: /\b(customers?|consumers?|shoppers?|buyers?|audiences?)\s+(will|would)\b/iu, why: "consumer-behaviour prediction" },
  { pattern: /\b(will|would)\s+(succeed|fail|sell|buy|convert|win)\b/iu, why: "business-outcome prediction" },
  { pattern: /\bpredict(s|ed|ion|ions)?\b|\bforecast/iu, why: "prediction claim: Qloo evidence measures cultural affinity, not outcomes" },
  { pattern: /\b(score|scores|scored|index)\b|\/\s*100\b/iu, why: "no approved score or index exists" },
  { pattern: /\bconfidence\b/iu, why: "no confidence measure exists" },
  { pattern: /\b(distance|distances|path|paths|hops?)\b/iu, why: "Qloo exposes no distance or path (use 'Cultural Distance Proxy' only when one is defined)" },
];

/** A directly negated noun disclaimer ("not a prediction", "no score", "nor any confidence measure") is not a claim. */
const NEGATED_DISCLAIMER = /\b(?:no|not|never|nor|without)\s+(?:a|an|any|the)?\s*(?:predictions?|forecasts?|scores?|index|confidence|guarantees?)\b/giu;

function escape(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

/** Every number that appears anywhere in the deterministic results. */
export function allowedNumbers(results: readonly AgentTerritoryResult[]): Set<number> {
  const out = new Set<number>([results.length]);
  const walk = (value: unknown) => {
    if (typeof value === "number" && Number.isFinite(value)) {
      out.add(value);
      out.add(Number(value.toFixed(3)));
      out.add(Number(value.toFixed(2)));
      out.add(Number(value.toFixed(1)));
    } else if (typeof value === "string") {
      for (const m of value.matchAll(/\d+(?:\.\d+)?/gu)) out.add(Number(m[0]));
    } else if (Array.isArray(value)) value.forEach(walk);
    else if (value && typeof value === "object") Object.values(value).forEach(walk);
  };
  for (const r of results) {
    const { provenance: _provenance, ...rest } = r;
    walk(rest);
    out.add(r.representation.exemplars.length);
    if (r.comparisonSet) out.add(r.comparisonSet.territoryKeys.length);
  }
  return out;
}

function sentences(text: string): string[] {
  return text.split(/(?<=[.!?])\s+|\n+/u).filter((s) => s.trim().length > 0);
}

function mentioned(sentence: string, results: readonly AgentTerritoryResult[]): AgentTerritoryResult[] {
  return results.filter((r) => new RegExp(`(^|[^\\p{L}\\p{N}])(${escape(r.label)}|${escape(r.key)})([^\\p{L}\\p{N}]|$)`, "iu").test(sentence));
}

function levelClaims(text: string, patterns: RegExp[]): string[] {
  const levels: string[] = [];
  for (const pattern of patterns) for (const m of text.matchAll(pattern)) levels.push(m[1]!.toUpperCase());
  return levels;
}

function checkSegment(segment: string, scope: AgentTerritoryResult[] | "sentence", results: readonly AgentTerritoryResult[], where: string, violations: string[]) {
  for (const sentence of sentences(segment)) {
    // A sentence that names no territory in a single-territory run can only be about that territory.
    const named = scope === "sentence" ? mentioned(sentence, results) : scope;
    const targets = named.length === 0 && scope === "sentence" && results.length === 1 ? [...results] : named;
    for (const [label, pattern] of CLASS_PATTERNS) {
      if (!pattern.test(sentence)) continue;
      if (targets.length === 0) violations.push(`${where}: class language "${label}" is not attached to a named territory: "${sentence.trim().slice(0, 160)}"`);
      else if (!targets.some((t) => t.classification?.label === label)) violations.push(`${where}: "${label}" does not match the deterministic class of ${targets.map((t) => `${t.label} (${t.classification?.label ?? "no class"})`).join(", ")}`);
    }
    for (const level of levelClaims(sentence, ROBUSTNESS_PATTERNS)) {
      if (targets.length === 0) violations.push(`${where}: robustness level ${level} is not attached to a named territory`);
      else if (!targets.some((t) => t.robustness?.level === level)) violations.push(`${where}: robustness ${level} does not match ${targets.map((t) => `${t.label} (${t.robustness?.level ?? "not measured"})`).join(", ")}`);
    }
    // "consistently shared" names a coherence field, not a robustness claim (Sprint 4 live false positive).
    // Sprint 5A live false positive: "tentative rather than stable" / "not robust" next to a stated LOW level is the
    // correct description of weak robustness. Only an affirmative robust/stable claim counts. A negation's scope ends at
    // punctuation or a contrast word ("not the leader but robust" is still a claim).
    const affirmative = sentence.replace(/\b(?:not|n't|cannot|never|nor|no longer|rather than|instead of|less|than)\s+(?:(?!(?:but|yet|although|however|though|while)\b)[\w-]+\s+){0,10}?(?:robust|robustly|stable|stability)\b/giu, " ");
    const statesWeakLevel = levelClaims(sentence, ROBUSTNESS_PATTERNS).some((l) => l === "LOW" || l === "INSUFFICIENT");
    if (!statesWeakLevel && /\b(robust|robustly|stable|stability)\b/iu.test(affirmative)) {
      const weak = targets.filter((t) => !t.robustness || t.robustness.level === "LOW" || t.robustness.level === "INSUFFICIENT");
      if (targets.length > 0 && weak.length === targets.length) violations.push(`${where}: robustness wording does not match ${weak.map((t) => `${t.label} (${t.robustness?.level ?? "not measured"})`).join(", ")}`);
    }
    for (const level of levelClaims(sentence, QUALITY_PATTERNS)) {
      if (targets.length === 0) violations.push(`${where}: evidence quality ${level} is not attached to a named territory`);
      else if (!targets.some((t) => t.evidenceQuality?.level === level)) violations.push(`${where}: evidence quality ${level} does not match ${targets.map((t) => `${t.label} (${t.evidenceQuality?.level ?? "not assessed"})`).join(", ")}`);
    }
  }
}

/** Fixed vocabulary that may appear capitalized without being a run entity. */
const FIXED_TERMS = ["qloo", "cultural elasticity", "relative elasticity index", "cultural distance proxy", "natural adjacency", "credible stretch", "cultural break", "evidence quality", "representation robustness", "full relative analysis", "partial cultural analysis", "descriptive analysis", "insufficient evidence"];

/** Multi-word Capitalized sequences ("Specialty Coffee Bars") that name nothing in the run. */
function unknownNames(text: string, vocabulary: readonly string[]): string[] {
  const vocab = [...vocabulary, ...FIXED_TERMS].map((v) => v.toLowerCase()).filter(Boolean);
  const out: string[] = [];
  for (const m of text.matchAll(/(?:\b[A-Z][\p{Ll}][\p{L}'’&-]*\s+){1,5}[A-Z][\p{Ll}][\p{L}'’&-]*\b/gu)) {
    const phrase = m[0].replace(/['’]s$/u, "").trim();
    const lower = phrase.toLowerCase();
    if (vocab.some((v) => v === lower || v.includes(lower) || lower.includes(v))) continue;
    // A sentence-initial capitalized word followed by one capitalized name is allowed when the rest is known.
    const tail = lower.split(/\s+/u).slice(1).join(" ");
    if (tail && vocab.some((v) => v === tail || v.includes(tail))) continue;
    out.push(phrase);
  }
  return out;
}

/** Run-level counts a sentence may state without naming a territory. */
export function runLevelNumbers(results: readonly AgentTerritoryResult[]): Set<number> {
  const out = new Set<number>([results.length, 3]);
  for (const route of ["FULL_RELATIVE_ANALYSIS", "PARTIAL_CULTURAL_ANALYSIS", "DESCRIPTIVE_ANALYSIS", "INSUFFICIENT_EVIDENCE"]) out.add(results.filter((r) => r.analysisRoute === route).length);
  out.add(results.filter((r) => r.classification).length);
  for (const r of results) if (r.comparisonSet) out.add(r.comparisonSet.territoryKeys.length);
  return out;
}

export function validateClaims(synthesis: Pick<Synthesis, "summary" | "territoryNotes" | "followUpOptions">, results: readonly AgentTerritoryResult[], extraLabels: readonly string[] = []): string[] {
  const violations: string[] = [];
  const byKey = new Map(results.map((r) => [r.key, r]));
  const runNumbers = runLevelNumbers(results);
  const scopedNumbers = new Map(results.map((r) => [r.key, allowedNumbers([r])]));
  const numbersFor = (territories: readonly AgentTerritoryResult[]) => new Set([...runNumbers, ...territories.flatMap((t) => [...scopedNumbers.get(t.key)!])]);
  const labels = [...results.map((r) => r.label), ...results.map((r) => r.key), ...extraLabels, ...results.flatMap((r) => r.representation.exemplars.map((e) => e.label)), ...results.flatMap((r) => r.conditionedEvidence?.topEntities.map((e) => e.label) ?? [])];
  const vocabulary = [...labels, ...results.flatMap((r) => (r.resolvedConcept ? [r.resolvedConcept.label] : [])), ...results.flatMap((r) => r.representation.rejectedExemplars.map((x) => x.label)), ...results.flatMap((r) => r.coherence?.consistentlyShared.map((x) => x.label) ?? [])];

  const texts: { where: string; text: string; scope: AgentTerritoryResult[] | "sentence" }[] = [
    { where: "summary", text: synthesis.summary, scope: "sentence" },
    ...synthesis.followUpOptions.map((text, i) => ({ where: `followUpOptions[${i}]`, text, scope: "sentence" as const })),
  ];
  for (const note of synthesis.territoryNotes) {
    const territory = byKey.get(note.territoryKey);
    if (!territory) {
      violations.push(`territoryNotes: unknown territory "${note.territoryKey}"`);
      continue;
    }
    texts.push({ where: `territoryNotes.${note.territoryKey}`, text: note.text, scope: [territory] });
  }

  const sortedLabels = [...labels].filter(Boolean).sort((a, b) => b.length - a.length);
  for (const { where, text, scope } of texts) {
    // Names may contain digits ("Studio 54"); remove them before number checks.
    let stripped = text;
    for (const label of sortedLabels) stripped = stripped.replace(new RegExp(escape(label), "giu"), " ");
    const disclaimed = stripped.replace(NEGATED_DISCLAIMER, " ");
    for (const { pattern, why } of FORBIDDEN_LANGUAGE) {
      const hit = disclaimed.match(pattern);
      if (hit && !/cultural distance proxy/iu.test(disclaimed.slice(Math.max(0, (hit.index ?? 0) - 20), (hit.index ?? 0) + 20))) violations.push(`${where}: forbidden language "${hit[0]}" (${why})`);
    }
    // Numbers are grounded per sentence: the territory a note is about, or the territories a sentence names.
    for (const sentence of sentences(text)) {
      const allowed = numbersFor(scope === "sentence" ? mentioned(sentence, results) : scope);
      let bare = sentence;
      for (const label of sortedLabels) bare = bare.replace(new RegExp(escape(label), "giu"), " ");
      for (const m of bare.matchAll(/(?<![\p{L}\d.])\d+(?:\.\d+)?(?![\d])/gu)) {
        if (!allowed.has(Number(m[0]))) violations.push(`${where}: number ${m[0]} does not appear in the deterministic results of ${scope === "sentence" ? "the territories this sentence names" : scope.map((t) => t.label).join(", ")}`);
      }
    }
    for (const name of unknownNames(text, vocabulary)) violations.push(`${where}: "${name}" is not a territory, concept, brand or entity in this run's state`);
    checkSegment(text, scope, results, where, violations);
  }
  return [...new Set(violations)];
}

// ---- Sprint 5A: grounded findings and rejection categories ----

export const CLAIM_TYPES = ["relative_position", "classification", "robustness", "shared_signals", "conditioned_evidence", "evidence_quality", "representation", "route_limitation"] as const;

/** Result field each claim type needs (null = always available). */
const CLAIM_REQUIRES: Record<(typeof CLAIM_TYPES)[number], string | null> = {
  relative_position: "relativePosition",
  classification: "classification",
  robustness: "robustness",
  shared_signals: "coherence",
  conditioned_evidence: "conditionedEvidence",
  evidence_quality: "evidenceQuality",
  representation: null,
  route_limitation: null,
};

function at(value: unknown, path: string): unknown {
  let cur: unknown = value;
  for (const part of path.split(".")) {
    if (cur === null || cur === undefined) return undefined;
    cur = Array.isArray(cur) && /^\d+$/u.test(part) ? cur[Number(part)] : (cur as Record<string, unknown>)[part];
  }
  return cur;
}

function numbersIn(value: unknown, out = new Set<number>()): Set<number> {
  if (typeof value === "number" && Number.isFinite(value)) for (const v of [value, Number(value.toFixed(3)), Number(value.toFixed(2)), Number(value.toFixed(1))]) out.add(v);
  else if (typeof value === "string") for (const m of value.matchAll(/\d+(?:\.\d+)?/gu)) out.add(Number(m[0]));
  else if (Array.isArray(value)) value.forEach((v) => numbersIn(v, out));
  else if (value && typeof value === "object") Object.values(value).forEach((v) => numbersIn(v, out));
  return out;
}

/**
 * Validates model-selected findings against the deterministic results: the territory exists, the claim type is
 * supported by its route, every supporting field resolves to a value in that territory's result view, limitation
 * codes are the territory's own, and every number in the interpretation is a value of the cited fields.
 */
export function validateFindings(findings: readonly GroundedFinding[], results: readonly AgentTerritoryResult[]): string[] {
  const violations: string[] = [];
  const views = new Map(results.map((r) => [r.key, synthesisTerritoryView(r)]));
  for (const [i, f] of findings.entries()) {
    const where = `findings[${i}]`;
    const view = views.get(f.territoryKey);
    if (!view) {
      violations.push(`${where}: unknown territory "${f.territoryKey}"`);
      continue;
    }
    const required = CLAIM_REQUIRES[f.claimType as (typeof CLAIM_TYPES)[number]];
    if (required === undefined) violations.push(`${where}: unknown claimType "${f.claimType}" (use one of ${CLAIM_TYPES.join(", ")})`);
    else if (required && (at(view, required) === null || at(view, required) === undefined)) violations.push(`${where}: claimType ${f.claimType} is not supported for ${view.label} (route ${view.route}; ${required} is not available)`);
    const cited = new Set<number>();
    for (const path of f.supportingFields) {
      const value = at(view, path);
      if (value === null || value === undefined) violations.push(`${where}: supporting field "${path}" has no value for ${view.label}`);
      else numbersIn(value, cited);
    }
    const codes = new Set(view.limitations);
    for (const code of f.limitationCodes) if (!codes.has(code)) violations.push(`${where}: limitation ${code} is not one of ${view.label}'s limitations`);
    let text = f.interpretation;
    for (const label of [view.label, view.territoryKey, ...(view.comparisonSet ?? [])].sort((a, b) => b.length - a.length)) if (label) text = text.replace(new RegExp(escape(label), "giu"), " ");
    for (const m of text.matchAll(/(?<![\p{L}\d.])\d+(?:\.\d+)?(?![\d])/gu)) if (!cited.has(Number(m[0]))) violations.push(`${where}: number ${m[0]} is not a value of its supporting fields (${f.supportingFields.join(", ") || "none"})`);
  }
  return violations;
}

export const VIOLATION_CATEGORIES = ["SCHEMA", "INVENTED_NUMBER", "UNSUPPORTED_CLASSIFICATION", "MISMATCHED_ROBUSTNESS", "MISMATCHED_EVIDENCE_QUALITY", "PROHIBITED_COMMERCIAL_OR_PREDICTION", "UNSUPPORTED_CAUSAL", "PROHIBITED_METRIC_LANGUAGE", "INVALID_NAMED_ENTITY", "UNKNOWN_TERRITORY", "UNGROUNDED_FINDING", "OTHER"] as const;
export type ViolationCategory = (typeof VIOLATION_CATEGORIES)[number];

/** Rejection category of one validator violation (for the synthesis rejection report). */
export function classifyViolation(v: string): ViolationCategory {
  if (/synthesis (schema|output invalid)/u.test(v)) return "SCHEMA";
  if (/unknown territory/u.test(v)) return "UNKNOWN_TERRITORY";
  if (/^findings\[/u.test(v) && !/number/u.test(v)) return "UNGROUNDED_FINDING";
  if (/number .* (does not appear|is not a value)/u.test(v)) return "INVENTED_NUMBER";
  if (/class language|does not match the deterministic class/u.test(v)) return "UNSUPPORTED_CLASSIFICATION";
  if (/robustness/u.test(v)) return "MISMATCHED_ROBUSTNESS";
  if (/evidence quality/u.test(v)) return "MISMATCHED_EVIDENCE_QUALITY";
  if (/causal/u.test(v)) return "UNSUPPORTED_CAUSAL";
  if (/commercial|prediction|probability|certainty|guarantee|consumer-behaviour|business-outcome/u.test(v)) return "PROHIBITED_COMMERCIAL_OR_PREDICTION";
  if (/score|index|confidence|distance|percentages/u.test(v)) return "PROHIBITED_METRIC_LANGUAGE";
  if (/is not a territory, concept, brand or entity/u.test(v)) return "INVALID_NAMED_ENTITY";
  return "OTHER";
}

export function categorize(violations: readonly string[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const v of violations) out[classifyViolation(v)] = (out[classifyViolation(v)] ?? 0) + 1;
  return out;
}
