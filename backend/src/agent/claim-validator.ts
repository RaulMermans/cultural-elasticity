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
 * A violation rejects the synthesis (one retry with feedback, then a deterministic template).
 */
import type { AgentTerritoryResult, ElasticityClass } from "@cultural-elasticity/shared";
import type { Synthesis } from "./contracts.js";

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
    const targets = scope === "sentence" ? mentioned(sentence, results) : scope;
    for (const [label, pattern] of CLASS_PATTERNS) {
      if (!pattern.test(sentence)) continue;
      if (targets.length === 0) violations.push(`${where}: class language "${label}" is not attached to a named territory: "${sentence.trim().slice(0, 160)}"`);
      else if (!targets.some((t) => t.classification?.label === label)) violations.push(`${where}: "${label}" does not match the deterministic class of ${targets.map((t) => `${t.label} (${t.classification?.label ?? "no class"})`).join(", ")}`);
    }
    for (const level of levelClaims(sentence, ROBUSTNESS_PATTERNS)) {
      if (targets.length === 0) violations.push(`${where}: robustness level ${level} is not attached to a named territory`);
      else if (!targets.some((t) => t.robustness?.level === level)) violations.push(`${where}: robustness ${level} does not match ${targets.map((t) => `${t.label} (${t.robustness?.level ?? "not measured"})`).join(", ")}`);
    }
    if (/\b(robust|robustly|stable|consistently)\b/iu.test(sentence)) {
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

export function validateClaims(synthesis: Synthesis, results: readonly AgentTerritoryResult[], extraLabels: readonly string[] = []): string[] {
  const violations: string[] = [];
  const byKey = new Map(results.map((r) => [r.key, r]));
  const numbers = allowedNumbers(results);
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

  for (const { where, text, scope } of texts) {
    // Names may contain digits ("Studio 54"); remove them before number checks.
    let stripped = text;
    for (const label of [...labels].sort((a, b) => b.length - a.length)) if (label) stripped = stripped.replace(new RegExp(escape(label), "giu"), " ");
    for (const { pattern, why } of FORBIDDEN_LANGUAGE) {
      const hit = stripped.match(pattern);
      if (hit && !/cultural distance proxy/iu.test(stripped.slice(Math.max(0, (hit.index ?? 0) - 20), (hit.index ?? 0) + 20))) violations.push(`${where}: forbidden language "${hit[0]}" (${why})`);
    }
    for (const m of stripped.matchAll(/(?<![\p{L}\d.])\d+(?:\.\d+)?(?![\d])/gu)) {
      if (!numbers.has(Number(m[0]))) violations.push(`${where}: number ${m[0]} does not appear in the deterministic results`);
    }
    for (const name of unknownNames(text, vocabulary)) violations.push(`${where}: "${name}" is not a territory, concept, brand or entity in this run's state`);
    checkSegment(text, scope, results, where, violations);
  }
  return [...new Set(violations)];
}
