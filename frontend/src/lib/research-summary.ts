/**
 * Deterministic Research Summary. Built only from a ResearchView (itself built from the canonical result).
 * The on-screen summary and the downloadable HTML render the same sections, so they cannot disagree.
 * No model call, no new numbers, no recommendation added to fill space.
 */
import { domainWords } from "./research-copy.ts";
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

export function buildSummary(view: ResearchView): ResearchSummary {
  const brand = view.brand.name;
  const sections: SummarySection[] = [];

  const connectionItems: SummaryItem[] = view.collections.map((collection) => {
    const words = domainWords(collection.domain);
    return { text: `${words.title} (${collection.items.length}): ${collection.items.map((item) => item.name).join("; ")}`, detail: collection.qualifier };
  });
  if (view.tasteTags.length) connectionItems.push({ text: `Cultural tags: ${view.tasteTags.map((item) => item.name).join("; ")}`, detail: "Tags Qloo associates with the brand, in Qloo's order." });
  if (view.keywords.length) connectionItems.push({ text: `Descriptive keywords: ${view.keywords.map((item) => item.name).join("; ")}`, detail: "Loose keywords, not curated categories." });
  sections.push({
    id: "connections",
    title: "Cultural connections discovered",
    intro: connectionItems.length ? "Observed Qloo associations, listed in Qloo's order. Order is not a ranking of strength or opportunity." : undefined,
    items: connectionItems.length ? connectionItems : [{ text: "Qloo returned no cultural connections in this research." }],
  });

  sections.push({
    id: "position",
    title: `${brand}'s current position`,
    items: [{ text: view.core.note }],
  });

  sections.push({
    id: "directions",
    title: "Directions to investigate",
    intro: view.directions.length ? "Research directions, not validated findings or recommendations." : undefined,
    items: view.directions.length
      ? view.directions.map((direction) => ({ text: `${direction.name}: ${direction.categoryLabel}.`, detail: `Why it appeared: ${direction.why} Next question: ${direction.nextQuestion}` }))
      : [{ text: "The available evidence does not yet support a specific direction." }],
  });

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
    title: "Unanswered questions",
    items: view.unresolved.length ? view.unresolved.map((item) => ({ text: item.title, detail: item.detail })) : [{ text: "No open question was recorded beyond the limitations below." }],
  });

  const limitations = [...view.uncertainties];
  if (view.setAside.length) limitations.push(`${view.setAside.length} returned tags described store or venue listings and were set aside as operational metadata, not culture.`);
  limitations.push("Nothing here measures commercial potential, cultural distance or audience size.");
  sections.push({ id: "limitations", title: "Evidence limitations", items: limitations.map((text) => ({ text })) });

  sections.push({
    id: "next",
    title: "Next research steps",
    items: (view.nextSteps.length ? view.nextSteps : [`Repeat the research for ${brand} with the current method when new research is available.`]).map((text) => ({ text })),
  });

  return {
    title: `${brand}: cultural research summary`,
    brand,
    objective: view.objective,
    provenanceLine: view.origin === "recorded"
      ? "Recorded Qloo research. It was captured earlier and is not a new live run."
      : "Live Qloo research from this session.",
    researchDate: formatDate(view.capturedAt),
    outcome: { headline: view.outcome.headline, detail: view.outcome.detail },
    sections,
    sources: view.method.sources.map((ref) => ({
      label: ref.operation === "describe" ? "Brand lookup" : ref.operation === "entity_tags" ? "Cultural tag profile" : `Related ${domainWords(ref.scope).plural}`,
      capturedAt: formatDate(ref.capturedAt),
      status: ref.sourceStatus === "ok" ? "complete response" : `${ref.sourceStatus} response`,
      reference: ref.correlationId,
    })),
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
