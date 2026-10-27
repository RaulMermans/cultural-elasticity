/**
 * Deterministic Research Summary. Built only from a ResearchView (itself built from the canonical result).
 * The on-screen summary and the downloadable HTML render the same sections, so they cannot disagree.
 * No model call, no new numbers, no recommendation added to fill space.
 */
import { domainWords, hypothesisOutcomeCopy } from "./research-copy.ts";
import { outcomeCopy, relationshipKindCopy } from "./comparative.ts";
import type { ComparativeStrategicReport, CulturalConnectionMap, QueryResponse } from "@cultural-elasticity/shared";
import type { ResearchView } from "./research-view.ts";

export type SummaryItem = { text: string; detail?: string };
export type SummarySection = { id: string; title: string; intro?: string; items: SummaryItem[] };
export type ResearchSummary = {
  title: string;
  brand: string;
  objective: string;
  provenanceLine: string;
  researchDate: string;
  outcome: { headline: string; detail: string };
  sections: SummarySection[];
  sources: { label: string; capturedAt: string; status: string; reference: string }[];
  footer: string;
};

export const formatDate = (iso: string) => new Date(iso).toLocaleString("en-GB", { dateStyle: "long", timeStyle: "short", timeZone: "UTC" }) + " UTC";

/** Sprint 9I: a server-validated comparative report and its relationship map, for the same brand only. */
export type ComparativeInput = { report: ComparativeStrategicReport; connections: CulturalConnectionMap | null };

const positionText = (position: { position: number | null; of: number; medianPercentile: number | null } | null) =>
  position?.position != null ? `position ${position.position} of ${position.of}${position.medianPercentile !== null ? ` (${Math.round(position.medianPercentile * 100)}th percentile)` : ""}` : "not ranked";

export function buildSummary(view: ResearchView, investigation: QueryResponse | null = null, comparativeInput: ComparativeInput | null = null): ResearchSummary {
  const brand = view.brand.name;
  const sections: SummarySection[] = [];
  const comparative = comparativeInput && comparativeInput.report.brand.id === view.brand.qlooId ? comparativeInput : null;
  const report = comparative?.report ?? null;
  const run = investigation?.investigation?.result;
  const matched = run && run.status !== "NEEDS_INPUT" && run.status === "COMPLETE" && run.brand?.id === view.brand.qlooId && (run.evidenceOrigin === "live" || run.evidenceOrigin === "recorded") ? run : null;
  const targets = matched?.territories.filter((item) => item.role === "target") ?? [];
  const hypothesis = matched?.hypothesisAssessment;
  const fullComparative = matched?.territories.filter((t) => t.analysisRoute === "FULL_RELATIVE_ANALYSIS" && t.relativePosition && t.classification) ?? [];

  if (hypothesis) sections.push({ id: "hypothesis", title: "Single Direction Investigation", intro: "A qualitative cultural research judgment, not commercial validation.", items: [
    { text: `${hypothesisOutcomeCopy[hypothesis.outcome]}. ${hypothesis.question}` },
    ...hypothesis.observed.map((text) => ({ text, detail: "Observed Qloo relationship." })),
    ...hypothesis.supports.map((text) => ({ text, detail: "Deterministic interpretation of source-linked evidence." })),
    ...hypothesis.limitations.map((text) => ({ text, detail: "Limitation." })),
    ...hypothesis.unknowns.map((text) => ({ text, detail: "Not established by this research." })),
    { text: hypothesis.nextStep, detail: "Suggested next research step." },
  ] });

  sections.push({ id: "profile", title: "Brand Cultural Profile", items: [{ text: view.core.note }] });

  const connectionItems: SummaryItem[] = view.collections.map((collection) => {
    const words = domainWords(collection.domain);
    return { text: `${words.title} (${collection.items.length}): ${collection.items.map((item) => item.name).join("; ")}`, detail: collection.qualifier };
  });
  if (view.tasteTags.length) connectionItems.push({ text: `Cultural tags: ${view.tasteTags.map((item) => item.name).join("; ")}`, detail: "Tags Qloo associates with the brand, in Qloo's order." });
  if (view.keywords.length) connectionItems.push({ text: `Descriptive keywords: ${view.keywords.map((item) => item.name).join("; ")}`, detail: "Loose keywords, not curated categories." });
  sections.push({
    id: "connections",
    title: "Cultural Connections",
    intro: connectionItems.length ? "Observed Qloo associations, listed in Qloo's order. Order is not a ranking of strength or opportunity." : undefined,
    items: connectionItems.length ? connectionItems : [{ text: "Qloo returned no cultural connections in this research." }],
  });

  sections.push({
    id: "directions",
    title: "Investigated Territories",
    intro: view.directions.length ? "Research directions, not validated findings or recommendations." : undefined,
    items: view.directions.length
      ? view.directions.map((direction) => ({ text: `${direction.name}: ${targets.some((target) => target.label === direction.name) ? "investigated in this session" : "unvalidated baseline hypothesis"}. ${direction.categoryLabel}.`, detail: `Why it appeared: ${direction.why} Next question: ${direction.nextQuestion}` }))
      : [{ text: "The available evidence does not yet support a specific direction." }],
  });

  sections.push({ id: "observations", title: "Key Observations", items: targets.length ? targets.flatMap((target) => target.keyEvidence.map((text) => ({ text, detail: `From the ${target.label} investigation.` }))) : [{ text: "No completed, matching deep investigation is attached to this brief. The cultural connections above remain baseline observations." }] });
  sections.push({ id: "interpretations", title: "Supported Interpretations", items: matched && matched.summary.claimValidation.passed ? [{ text: matched.summary.text, detail: `Validated against the ${brand} investigation result.` }] : [{ text: "No validated agent interpretation is available for this brand in this brief." }] });
  if (report) {
    const outcome = outcomeCopy[report.outcome];
    const target = report.targetTerritory;
    sections.push({
      id: "comparison",
      title: "Comparative Cultural Elasticity Assessment",
      intro: `${outcome.headline}. ${outcome.detail} Candidate set: [${target.candidateSet.join(", ")}]. Evidence: ${report.evidenceOrigin === "synthetic" ? "SYNTHETIC test world, not Qloo" : report.evidenceOrigin}.`,
      items: [
        { text: `${target.name} (proposed): ${positionText(target.relativePosition)}. Classification: ${target.provisionalClassification?.label ?? "none"}.`, detail: [target.robustness ? `Robustness ${target.robustness.level}: ${target.robustness.sensitivityDetail}` : null, target.coherence ? `Coherence ${target.coherence.band}.` : null, target.evidenceQuality ? `Evidence quality ${target.evidenceQuality.level}.` : null].filter(Boolean).join(" ") || undefined },
        ...report.alternativesEvaluated.map((alt) => ({ text: `${alt.name}: ${positionText(alt.relativePosition)}. Classification: ${alt.classification?.label ?? "none"}.`, detail: alt.comparisonLimitation ?? (alt.robustness ? `Robustness ${alt.robustness.level}.` : undefined) })),
        ...report.whatEvidenceEstablishes.map((text) => ({ text, detail: "Established by Qloo evidence or deterministic analysis." })),
        ...report.strategicImplications.map((text) => ({ text, detail: "Deterministic reading of the relative result." })),
        ...(report.interpretation ? [{ text: report.interpretation.text, detail: "Validated interpretation; not evidence." }] : []),
      ],
    });
  } else if (fullComparative.length >= 2) {
    const candidateSet = fullComparative[0]!.comparisonSet?.labels.join(", ") ?? fullComparative.map((t) => t.label).join(", ");
    sections.push({
      id: "comparison",
      title: "Comparative Cultural Elasticity Assessment",
      intro: `Relative ranking and provisional classification derived from compatible Qloo evidence. Positions and classifications are relative strictly to candidate set [${candidateSet}]:`,
      items: fullComparative.map((t) => ({
        text: `${t.label}: Rank position ${t.relativePosition!.position} of ${t.relativePosition!.of} (${Math.round((t.relativePosition!.medianPercentile ?? 0) * 100)}th percentile). Provisional classification: ${t.classification!.label}.`,
        detail: `Robustness is ${t.robustness?.level.toLowerCase() ?? "unspecified"}. ${t.keyEvidence[0] ?? ""}`,
      })),
    });
  } else {
    sections.push({
      id: "comparison",
      title: "Comparison of Research Directions",
      items: targets.length >= 2
        ? targets.map((target) => ({ text: `${target.label}: ${target.keyEvidence[0] ?? "no supported observation"}`, detail: "Read side by side only; separate Qloo calls are not combined or ranked." }))
        : [{ text: "Fewer than two matching investigated territories are available. No relative comparison or winner is claimed." }],
    });
  }

  if (comparative?.connections && comparative.connections.relationships.length) {
    const map = comparative.connections;
    sections.push({
      id: "relationships",
      title: "Cultural Relationships Across Domains",
      intro: "Grouped by how each relationship was obtained. None of them enters a relative ranking.",
      items: [
        ...(["DIRECT_QLOO_OBSERVATION", "DERIVED_PROFILE_OVERLAP", "AGENT_INTERPRETATION"] as const).flatMap((kind) => {
          const items = map.relationships.filter((item) => item.kind === kind);
          return items.length ? [{ text: `${relationshipKindCopy[kind].label} (${items.length}): ${items.slice(0, 8).map((item) => `${item.from.label} → ${item.to.label} (${item.to.domain})`).join("; ")}`, detail: relationshipKindCopy[kind].note }] : [];
        }),
        ...map.notes.map((text) => ({ text, detail: "Limitation." })),
      ],
    });
  }

  const marked = view.directions.filter((direction) => direction.categoryBasis === "user");
  if (marked.length) {
    sections.push({
      id: "context",
      title: "Your context",
      intro: "Added by you during this session. It is not Qloo evidence and did not change any evidence.",
      items: marked.map((direction) => ({ text: direction.relation })),
    });
  }

  sections.push({
    id: "unanswered",
    title: "Unresolved Questions",
    items: view.unresolved.length ? view.unresolved.map((item) => ({ text: item.title, detail: item.detail })) : [{ text: "No open question was recorded beyond the limitations below." }],
  });

  const limitations = [...view.uncertainties, ...targets.flatMap((target) => target.limitations.map((item) => item.detail)), ...(report?.whatRemainsUnknown ?? [])];
  if (view.setAside.length) limitations.push(`${view.setAside.length} returned tags described store or venue listings and were set aside as operational metadata, not culture.`);
  limitations.push("Nothing here measures commercial potential, cultural distance or audience size.");
  sections.push({ id: "limitations", title: "Limitations and Missing Evidence", items: limitations.map((text) => ({ text })) });

  sections.push({
    id: "next",
    title: "Recommended Next Research Steps",
    items: [...new Set([...(report?.nextResearchActions ?? []), ...(matched?.followUpOptions ?? []), ...(view.nextSteps.length ? view.nextSteps : [`Repeat the research for ${brand} with the current method when new research is available.`])])].map((text) => ({ text })),
  });

  sections.push({ id: "method", title: "Research Date and Methodology Version", items: [{ text: `Baseline captured ${formatDate(view.capturedAt)}. Baseline method ${view.method.templateVersion}. ${matched ? `Deep investigation run ${matched.runId}; method ${matched.schemaVersion}.` : "No matching deep investigation is included."}` }] });

  const sources = view.method.sources.map((ref) => ({
    label: ref.operation === "describe" ? "Brand lookup" : ref.operation === "entity_tags" ? "Cultural tag profile" : `Related ${domainWords(ref.scope).plural}`,
    capturedAt: formatDate(ref.capturedAt),
    status: ref.sourceStatus === "ok" ? "complete response" : `${ref.sourceStatus} response`,
    reference: ref.correlationId,
  }));
  for (const target of targets) for (const reference of target.provenance.correlationIds) {
    if (!sources.some((source) => source.reference === reference)) sources.push({ label: `${target.label} investigation`, capturedAt: "Investigation session", status: "agent result", reference });
  }
  for (const reference of report?.provenance.correlationIds ?? []) {
    if (!sources.some((source) => source.reference === reference)) sources.push({ label: "Comparative investigation", capturedAt: `Run ${report!.provenance.runId}`, status: `${report!.evidenceOrigin} result`, reference });
  }

  return {
    title: `${brand}: strategic research brief`,
    brand,
    objective: hypothesis?.question ?? view.objective,
    provenanceLine: hypothesis
      ? `${view.origin === "recorded" ? "Recorded baseline research captured earlier" : "Live baseline research from this session"}; separate live Qloo deep investigation included.`
      : view.origin === "recorded"
      ? "Recorded Qloo research. It was captured earlier and is not a new live run."
      : "Live Qloo research from this session.",
    researchDate: formatDate(view.capturedAt),
    outcome: report
      ? { headline: `Comparative assessment: ${outcomeCopy[report.outcome].headline}`, detail: report.targetTerritory.provisionalClassification ? `${report.targetTerritory.name} holds ${positionText(report.targetTerritory.relativePosition)} within [${report.targetTerritory.candidateSet.join(", ")}]; provisional class ${report.targetTerritory.provisionalClassification.label}. Relative to this set only.` : outcomeCopy[report.outcome].detail }
      : fullComparative.length >= 2
      ? {
          headline: `Comparative Assessment: ${fullComparative[0]!.label} (${fullComparative[0]!.classification!.label})`,
          detail: `Rank position ${fullComparative[0]!.relativePosition!.position} of ${fullComparative[0]!.relativePosition!.of} within candidate set [${fullComparative.map((t) => t.label).join(", ")}]. Position and provisional classification are relative strictly to this set.`,
        }
      : hypothesis
      ? { headline: hypothesisOutcomeCopy[hypothesis.outcome], detail: hypothesis.observed[0] ?? hypothesis.limitations[0] ?? "No supported relationship observation was established." }
      : { headline: view.outcome.headline, detail: view.outcome.detail },
    sections,
    sources,
    footer: view.derivedFrom
      ? `Read from stored observations of an earlier scan with the current method. The stored original is unchanged.`
      : "Generated from the stored research result.",
  };
}

const escape = (value: string) => value.replace(/[&<>"']/gu, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]!);

/** A standalone HTML document. All text is escaped; nothing is inserted as markup. */
export function renderSummaryHtml(summary: ResearchSummary, generatedAt: string): string {
  const section = (item: SummarySection) => `<section><h2>${escape(item.title)}</h2>${item.intro ? `<p class="intro">${escape(item.intro)}</p>` : ""}<ul>${item.items.map((entry) => `<li>${escape(entry.text)}${entry.detail ? `<br><span class="detail">${escape(entry.detail)}</span>` : ""}</li>`).join("")}</ul></section>`;
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escape(summary.title)}</title>
<style>
body{font-family:Georgia,"Iowan Old Style",serif;color:#1a1612;background:#fff;max-width:46rem;margin:2rem auto;padding:0 1rem;line-height:1.5}
h1{font-weight:500;font-size:2rem;margin:0 0 .25rem}h2{font-size:1.15rem;margin:1.75rem 0 .5rem;border-top:1px solid #d4cbb8;padding-top:1rem}
.meta,.detail,.intro,footer,td{color:#4a433b;font-size:.92rem}ul{padding-left:1.2rem}li{margin:.35rem 0}
.outcome{border-left:4px solid #9c4a2b;padding:.25rem 0 .25rem 1rem;margin:1.25rem 0}table{border-collapse:collapse;width:100%}td{border-top:1px solid #e4dccb;padding:.3rem .4rem;vertical-align:top;overflow-wrap:anywhere}
</style></head><body>
<h1>${escape(summary.title)}</h1>
<p class="meta">${escape(summary.provenanceLine)} Research date: ${escape(summary.researchDate)}.</p>
<p><strong>Research objective.</strong> ${escape(summary.objective)}</p>
<div class="outcome"><p><strong>${escape(summary.outcome.headline)}</strong></p><p>${escape(summary.outcome.detail)}</p></div>
${summary.sections.map(section).join("\n")}
<section><h2>Evidence sources</h2><table>${summary.sources.map((source) => `<tr><td>${escape(source.label)}</td><td>${escape(source.capturedAt)}</td><td>${escape(source.status)}</td><td>${escape(source.reference)}</td></tr>`).join("")}</table></section>
<footer><p>${escape(summary.footer)} Summary generated ${escape(generatedAt)} from the research result, without an AI model. Evidence support is not a commercial recommendation.</p></footer>
</body></html>
`;
}
