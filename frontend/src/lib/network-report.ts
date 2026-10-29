/**
 * A downloadable report of one research network: what the brand scan found, every investigation asked from it,
 * how each territory reads, the connections across branches, and what to ask next. It is a projection of results
 * already on the board: every class, rank and signal is read from the deterministic result, every sentence restates
 * them, and nothing is estimated, scored across calls or forecast. Pure: no provider call, no model call.
 */
import type { QueryResponse } from "@cultural-elasticity/shared";
import { connectionQuestions, territoryItems, type CrossLink, type EvidenceItem } from "./research-links.ts";
import { inquiryState, normName, type Inquiry, type NetworkNode } from "./research-network.ts";
import type { ResearchView } from "./research-view.ts";
import { readableClassCodes, territoryReading, type TerritoryReading } from "./territory-reading.ts";

export type ReportBlock = { heading?: string; meta?: string; text?: string; bullets?: string[] };
export type ReportSection = { id: string; title: string; intro?: string; blocks: ReportBlock[] };
export type NetworkReport = {
  brand: string;
  generatedAt: Date;
  stamp: { local: string; iso: string; file: string };
  origin: string;
  stats: { label: string; value: number }[];
  summary: string[];
  sections: ReportSection[];
};

type CardReading = { card: NetworkNode; reading: TerritoryReading; items: EvidenceItem[]; question: string; askedAt: number };

const pad = (value: number) => String(value).padStart(2, "0");
const list = (items: readonly string[]) => items.length <= 1 ? items.join("") : `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
const plural = (count: number, one: string, many = `${one}s`) => `${count} ${count === 1 ? one : many}`;

export function reportStamp(date: Date): NetworkReport["stamp"] {
  const local = new Intl.DateTimeFormat("en-GB", { dateStyle: "long", timeStyle: "short" }).format(date);
  const offset = -date.getTimezoneOffset();
  const zone = `UTC${offset >= 0 ? "+" : "-"}${pad(Math.floor(Math.abs(offset) / 60))}:${pad(Math.abs(offset) % 60)}`;
  const file = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}_${pad(date.getHours())}${pad(date.getMinutes())}`;
  return { local: `${local} (${zone})`, iso: date.toISOString(), file };
}

export function reportFileName(brand: string, date: Date, extension: "html" | "pdf"): string {
  const slug = brand.normalize("NFD").replace(/\p{M}/gu, "").replace(/[^\p{L}\p{N}]+/gu, "-").replace(/^-|-$/gu, "").toLowerCase() || "brand";
  return `${slug}-cultural-research_${reportStamp(date).file}.${extension}`;
}

/** The latest reading for each territory card: its own result, or a later question that grew from it about it. */
function cardReadings(nodes: readonly NetworkNode[], inquiries: readonly Inquiry[], brand: string, view: ResearchView): CardReading[] {
  const byJob = new Map(inquiries.map((item) => [item.jobId, item]));
  const otherDirections = view.directions.map((item) => item.name);
  const out: CardReading[] = [];
  for (const card of nodes) {
    if (card.kind !== "direction" && card.kind !== "finding") continue;
    const candidates: { response: QueryResponse; key: string | null; question: string; askedAt: number }[] = [];
    if (card.kind === "finding" && card.jobId) {
      const inquiry = byJob.get(card.jobId);
      if (inquiry?.response) candidates.push({ response: inquiry.response, key: card.territoryKey, question: inquiry.question, askedAt: inquiry.createdAt });
    }
    for (const child of nodes) {
      if (child.parentId !== card.id || child.kind !== "inquiry" || !child.jobId) continue;
      const inquiry = byJob.get(child.jobId);
      const own = inquiry?.response?.territories.find((item) => normName(item.name) === normName(card.label));
      if (inquiry?.response && own) candidates.push({ response: inquiry.response, key: own.territoryKey, question: inquiry.question, askedAt: inquiry.createdAt });
    }
    // Sprint 9O: the same decision-card context as the card's live dossier (ResearchNetwork), so the export prints its card.
    const direction = card.kind === "direction" ? view.directions.find((item) => item.key === card.directionKey) : undefined;
    const context = direction ? { directionWhy: direction.why, otherDirections } : { otherDirections };
    const latest = candidates
      .map((item) => ({ ...item, reading: territoryReading(item.response.investigation?.result, item.key, brand, context), items: territoryItems(item.response.investigation?.result, item.key)?.items ?? [] }))
      .filter((item): item is typeof item & { reading: TerritoryReading } => item.reading !== null)
      .sort((a, b) => b.askedAt - a.askedAt)[0];
    if (latest) out.push({ card, reading: latest.reading, items: latest.items, question: latest.question, askedAt: latest.askedAt });
  }
  // A territory found in several places is one territory: keep its latest reading only.
  const latestByName = new Map<string, CardReading>();
  for (const item of out) {
    const key = normName(item.card.label);
    const kept = latestByName.get(key);
    if (!kept || item.askedAt > kept.askedAt) latestByName.set(key, item);
  }
  return out.filter((item) => latestByName.get(normName(item.card.label)) === item);
}

const KIND_WORD: Record<EvidenceItem["kind"], string> = { concept: "Qloo concept", taste: "shared taste", example: "example entity" };
const ordinal = (n: number) => `${n}${n % 10 === 1 && n % 100 !== 11 ? "st" : n % 10 === 2 && n % 100 !== 12 ? "nd" : n % 10 === 3 && n % 100 !== 13 ? "rd" : "th"}`;

/**
 * Patterns across the whole network that are easy to miss card by card. Counts of shared Qloo identifiers and
 * per-comparison ranks only: nothing is averaged or ranked across calls.
 */
export function networkPatterns(readings: readonly CardReading[], inquiries: readonly Inquiry[], view: ResearchView, nodes: readonly NetworkNode[]): ReportBlock[] {
  const blocks: ReportBlock[] = [];
  // 1. Hub signals: the same Qloo identifier behind several different territories.
  const hubs = new Map<string, { item: EvidenceItem; names: Set<string> }>();
  for (const entry of readings) for (const item of entry.items) {
    const hub = hubs.get(item.id) ?? { item, names: new Set<string>() };
    hub.names.add(entry.card.label);
    hubs.set(item.id, hub);
  }
  const topHubs = [...hubs.values()].filter((hub) => hub.names.size >= 2).sort((a, b) => b.names.size - a.names.size || a.item.label.localeCompare(b.item.label)).slice(0, 5);
  if (topHubs.length) blocks.push({ heading: "Signals that run through several territories", text: "The same Qloo identifier sits behind territories you explored separately. These are the threads that tie the network together.", bullets: topHubs.map((hub) => `${hub.item.label} (${KIND_WORD[hub.item.kind]}): ${[...hub.names].join(", ")}`) });
  // 2. Contrasts: territories that share signals but read differently.
  const measured = readings.filter((entry) => entry.reading.fit);
  const contrasts: string[] = [];
  for (let i = 0; i < measured.length; i += 1) for (let j = i + 1; j < measured.length; j += 1) {
    const a = measured[i]!; const b = measured[j]!;
    if (a.reading.fit!.code === b.reading.fit!.code) continue;
    const theirs = new Set(b.items.map((item) => item.id));
    const shared = a.items.filter((item) => theirs.has(item.id));
    if (shared.length) contrasts.push(`${a.card.label} (${a.reading.fit!.label.toLowerCase()}) and ${b.card.label} (${b.reading.fit!.label.toLowerCase()}) share ${list(shared.slice(0, 3).map((item) => item.label))}, yet read differently. Comparing them in one question would show what separates them.`);
  }
  if (contrasts.length) blocks.push({ heading: "Same signals, different readings", bullets: contrasts.slice(0, 4) });
  // 3. Consistency: a territory ranked in more than one comparison, each rank stated within its own set.
  const appearances = new Map<string, { name: string; ranks: { position: number; of: number }[] }>();
  for (const inquiry of inquiries) {
    const result = inquiry.response?.investigation?.result;
    if (!result || result.status === "NEEDS_INPUT") continue;
    for (const territory of result.territories) {
      if (territory.relativePosition?.position == null || territory.relativePosition.of < 2) continue;
      const key = normName(territory.label);
      const entry = appearances.get(key) ?? { name: territory.label, ranks: [] };
      entry.ranks.push({ position: territory.relativePosition.position, of: territory.relativePosition.of });
      appearances.set(key, entry);
    }
  }
  const consistency = [...appearances.values()].filter((entry) => entry.ranks.length >= 2).map((entry) => {
    const stated = entry.ranks.map((rank) => `${ordinal(rank.position)} of ${rank.of}`).join(", ");
    if (entry.ranks.every((rank) => rank.position === 1)) return `${entry.name} came first in every comparison it was part of (${stated}).`;
    if (entry.ranks.every((rank) => rank.position === rank.of)) return `${entry.name} came last in every comparison it was part of (${stated}).`;
    if (entry.ranks.every((rank) => rank.position === entry.ranks[0]!.position)) return `${entry.name} held the same place in every comparison it was part of (${stated}).`;
    return `${entry.name}'s rank depends on what it is compared with (${stated}). Read it against its company, not on its own.`;
  });
  if (consistency.length) blocks.push({ heading: "How territories hold up across comparisons", text: "Each rank is stated within its own comparison; ranks from different comparisons are never combined.", bullets: consistency.slice(0, 5) });
  // 4. Closest matches that recur: the same entities at the top of several territories.
  const matches = new Map<string, Set<string>>();
  for (const entry of readings) for (const label of entry.reading.closestMatches) matches.set(label, (matches.get(label) ?? new Set()).add(entry.card.label));
  const recurring = [...matches.entries()].filter(([, names]) => names.size >= 2).sort((a, b) => b[1].size - a[1].size).slice(0, 5);
  if (recurring.length) blocks.push({ heading: "Entities Qloo keeps returning", bullets: recurring.map(([label, names]) => `${label}: among Qloo's closest matches in ${list([...names])}`) });
  // 5. Coverage: scan directions nobody has looked into yet.
  const investigated = new Set(nodes.filter((node) => node.kind === "inquiry" && node.parentId?.startsWith("dir:")).map((node) => node.parentId));
  const untouched = view.directions.filter((direction) => !investigated.has(`dir:${direction.key}`)).map((direction) => direction.name);
  if (untouched.length) blocks.push({ heading: "Blind spots", text: `${plural(untouched.length, "direction")} from the brand scan ${untouched.length === 1 ? "has" : "have"} not been investigated: ${list(untouched.slice(0, 8))}${untouched.length > 8 ? "…" : ""}.` });
  return blocks;
}

function readingLine(item: CardReading): string {
  const { reading } = item;
  const rank = reading.compared.find((entry) => entry.current);
  const parts = [reading.fit ? reading.fit.label : "Not measured yet"];
  if (rank && reading.compared.length > 1) parts.push(`ranked ${rank.position} of ${reading.compared.length} among ${list(reading.compared.map((entry) => entry.name))}`);
  if (reading.steadiness) parts.push(reading.steadiness.steady ? "steady across example sets" : "could change with other examples");
  return parts.join(" · ");
}

export function buildNetworkReport(input: { view: ResearchView; nodes: readonly NetworkNode[]; inquiries: readonly Inquiry[]; links: readonly CrossLink[]; now: Date }): NetworkReport {
  const { view, nodes, inquiries, links, now } = input;
  const brand = view.brand.name;
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const readings = cardReadings(nodes, inquiries, brand, view);
  const measured = readings.filter((item) => item.reading.fit);
  const byFit = (code: string) => measured.filter((item) => item.reading.fit!.code === code).map((item) => item.card.label);
  const natural = byFit("NATURAL_ADJACENCY");
  const stretch = byFit("CREDIBLE_STRETCH");
  const breaks = byFit("CULTURAL_BREAK");
  const unsettled = measured.filter((item) => !item.reading.fit!.onScale).map((item) => item.card.label);
  const unmeasured = readings.filter((item) => !item.reading.fit).map((item) => item.card.label);
  const solid = measured.filter((item) => (item.reading.fit!.code === "NATURAL_ADJACENCY" || item.reading.fit!.code === "CREDIBLE_STRETCH") && item.reading.steadiness?.steady);
  const finished = inquiries.filter((item) => item.response?.investigation?.result);

  const summary: string[] = [];
  summary.push(`${brand}'s Qloo brand scan proposed ${plural(view.directions.length, "direction")}. Since then, ${plural(inquiries.length, "question")} ${inquiries.length === 1 ? "was" : "were"} asked on the board and ${plural(finished.length, "investigation")} finished, giving a reading for ${plural(readings.length, "territory", "territories")}.`);
  if (measured.length) {
    const groups = [
      natural.length ? `${plural(natural.length, "natural fit")} (${list(natural)})` : "",
      stretch.length ? `${plural(stretch.length, "credible stretch", "credible stretches")} (${list(stretch)})` : "",
      breaks.length ? `${plural(breaks.length, "cultural break")} (${list(breaks)})` : "",
      unsettled.length ? `${unsettled.length} not settled (${list(unsettled)})` : "",
    ].filter(Boolean);
    summary.push(`Measured so far, each within its own Qloo comparison: ${list(groups)}.`);
  } else {
    summary.push("No territory has been measured yet. A degree of elasticity comes only from comparing territories within one Qloo call.");
  }
  if (solid.length) summary.push(`On the most solid footing: ${list(solid.map((item) => `${item.card.label} (${item.reading.fit!.label.toLowerCase()}, steady)`))}.`);
  if (unsettled.length) summary.push(`${list(unsettled)} ${unsettled.length === 1 ? "changes" : "change"} with the examples chosen, so ${unsettled.length === 1 ? "it needs" : "they need"} a wider comparison before any conclusion.`);
  if (unmeasured.length) summary.push(`Read but not yet measured: ${list(unmeasured.slice(0, 6))}${unmeasured.length > 6 ? ` and ${unmeasured.length - 6} more` : ""}. Comparing ${unmeasured.length === 1 ? "it" : "them"} with named territories would measure fit.`);
  if (links.length) {
    const top = links[0]!;
    summary.push(`${plural(links.length, "connection")} ${links.length === 1 ? "links" : "link"} different branches through the same Qloo signals; the widest is ${byId.get(top.a)?.label ?? "?"} × ${byId.get(top.b)?.label ?? "?"} (${plural(top.shared.length, "shared signal")}).`);
  }

  const sections: ReportSection[] = [];
  const patterns = networkPatterns(readings, inquiries, view, nodes);
  if (patterns.length) {
    sections.push({ id: "patterns", title: "Patterns you might overlook", intro: "Found by looking across every card at once: shared Qloo identifiers and per-comparison ranks, counted, never scored.", blocks: patterns });
    const hub = patterns.find((block) => block.heading === "Signals that run through several territories")?.bullets?.[0];
    if (hub) summary.push(`A thread worth noticing: ${hub}.`);
  }
  sections.push({
    id: "fingerprint",
    title: "Brand fingerprint",
    intro: view.outcome.headline,
    blocks: [
      { text: view.outcome.detail },
      ...(view.core.categories.length ? [{ heading: "Brand core (Qloo category tags)", bullets: view.core.categories.map((item) => item.name) }] : [{ text: view.core.note }]),
      ...(view.tasteTags.length ? [{ heading: "Taste signals", bullets: view.tasteTags.slice(0, 12).map((item) => item.name) }] : []),
      ...view.collections.slice(0, 4).map((collection) => ({ heading: collection.title, bullets: collection.items.slice(0, 8).map((item) => item.name) })),
    ],
  });
  sections.push({
    id: "directions",
    title: "Directions from the brand scan",
    blocks: view.directions.length ? view.directions.map((direction) => {
      const reading = readings.find((item) => item.card.directionKey === direction.key);
      return { heading: direction.name, meta: reading ? readingLine(reading) : "Not investigated yet", text: direction.why, bullets: direction.unknown.slice(0, 3) };
    }) : [{ text: view.noDirectionReasons.join(" ") || "The scan proposed no direction." }],
  });
  if (readings.length) {
    sections.push({
      id: "territories",
      title: "How each territory reads",
      intro: "Each reading comes from the latest investigation of that territory. Ranks hold only within the comparison named.",
      blocks: readings.map((item) => ({
        heading: item.card.label,
        meta: readingLine(item),
        text: item.reading.fit ? item.reading.fit.meaning : `${item.card.label} has not been compared with other territories yet.`,
        bullets: [
          ...(item.reading.decision ? [`Implication: ${item.reading.decision.implication.label}. ${item.reading.decision.implication.text}`, ...item.reading.decision.nextActions.map((action) => `Next: ${action.text}`)] : []),
          ...(item.reading.sharedTastes.length ? [`Tastes shared with ${brand}: ${item.reading.sharedTastes.slice(0, 6).join(", ")}`] : []),
          ...(item.reading.closestMatches.length ? [`Qloo's closest matches for ${brand} here: ${item.reading.closestMatches.slice(0, 6).join(", ")}`] : []),
          ...(item.reading.examples.length ? [`Examples standing for it: ${item.reading.examples.slice(0, 6).join(", ")}`] : []),
          ...item.reading.unknowns.slice(0, 3).map((line) => `Unknown: ${line}`),
          ...(item.reading.surfaced ? [`Evidence status: ${item.reading.surfaced.status}. ${item.reading.surfaced.statusText}`, ...(item.reading.surfaced.signals.length ? [`Surfaced from: ${item.reading.surfaced.signals.slice(0, 4).join("; ")}`] : []), ...(item.reading.surfaced.interpretation ? [`Agent's interpretation (not Qloo evidence): ${item.reading.surfaced.interpretation}`] : [])] : []),
          `From: “${item.question}”`,
        ],
      })),
    });
  }
  if (links.length) {
    sections.push({
      id: "connections",
      title: "Connections across branches",
      intro: "Two territories on different branches whose Qloo evidence carries the same identifiers. Shared evidence, not a similarity score.",
      blocks: links.map((link) => ({ heading: `${byId.get(link.a)?.label ?? "?"} × ${byId.get(link.b)?.label ?? "?"}`, bullets: link.shared.slice(0, 8).map((item) => `${item.kind === "concept" ? "Same Qloo concept" : item.kind === "taste" ? "Shared taste" : "Same example"}: ${item.label}`) })),
    });
  }
  sections.push({
    id: "log",
    title: "Investigation log",
    blocks: inquiries.length ? [...inquiries].sort((a, b) => a.createdAt - b.createdAt).map((inquiry) => {
      const result = inquiry.response?.investigation?.result;
      const text = result && result.status !== "NEEDS_INPUT" && result.summary.claimValidation.passed ? readableClassCodes(result.summary.text) : undefined;
      return { heading: inquiry.question, meta: `${inquiryState(inquiry).status} · asked ${reportStamp(new Date(inquiry.createdAt)).local}`, text };
    }) : [{ text: "No question has been asked on this board yet." }],
  });
  const asked = new Set(inquiries.map((item) => normName(item.question)));
  const next = [
    ...links.flatMap((link) => {
      const a = byId.get(link.a)?.label;
      const b = byId.get(link.b)?.label;
      return a && b ? connectionQuestions(brand, a, b, link.shared).map((item) => item.question) : [];
    }),
    ...unmeasured.map((name) => `Compare ${name} with `),
    ...finished.flatMap((item) => { const result = item.response!.investigation!.result; return result && result.status !== "NEEDS_INPUT" ? result.followUpOptions : []; }),
  ].filter((question) => !asked.has(normName(question)));
  const unique = [...new Set(next)].map((question) => question.endsWith(" ") ? `${question.trim()} territories you name` : question).slice(0, 8);
  sections.push({ id: "next", title: "What to ask next", blocks: unique.length ? [{ bullets: unique }] : [{ text: "Nothing pending. Ask a new question on the board to grow the network." }] });
  sections.push({
    id: "method",
    title: "How to read this report",
    blocks: [{ bullets: [
      "Every class, rank and signal comes from Qloo evidence, computed by tested code. The agent chooses what to investigate; it never sets a number.",
      "A rank holds only within the comparison it came from. Territories from different investigations are not ranked against each other.",
      "“Not settled” means the reading changes with the examples chosen; it is not a weak or a strong result.",
      "This describes cultural taste. It is not a forecast of sales, demand or partnership success.",
    ] }],
  });

  return {
    brand,
    generatedAt: now,
    stamp: reportStamp(now),
    origin: view.origin === "recorded" ? "Recorded Qloo evidence" : "Live Qloo evidence",
    stats: [
      { label: "Directions", value: view.directions.length },
      { label: "Questions", value: inquiries.length },
      { label: "Territories read", value: readings.length },
      { label: "Measured", value: measured.length },
      { label: "Connections", value: links.length },
    ],
    summary,
    sections,
  };
}

const escape = (value: string) => value.replace(/[&<>"']/gu, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]!);

export function renderReportHtml(report: NetworkReport): string {
  const block = (item: ReportBlock) => `<div class="block">${item.heading ? `<h3>${escape(item.heading)}</h3>` : ""}${item.meta ? `<p class="meta">${escape(item.meta)}</p>` : ""}${item.text ? `<p>${escape(item.text)}</p>` : ""}${item.bullets?.length ? `<ul>${item.bullets.map((line) => `<li>${escape(line)}</li>`).join("")}</ul>` : ""}</div>`;
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escape(report.brand)} · Cultural research report · ${escape(report.stamp.local)}</title>
<style>
:root{--ink:#1a1612;--soft:#4a423a;--muted:#7a6f63;--line:#e3d9c7;--paper:#fbf7f0;--copper:#93492b;--sage:#4a7a58}
*{box-sizing:border-box}body{margin:0;background:var(--paper);color:var(--ink);font:16px/1.55 ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif}
main{max-width:860px;margin:0 auto;padding:48px 24px 64px}
.eyebrow{text-transform:uppercase;letter-spacing:.12em;font-size:12px;color:var(--muted);margin:0}
h1{font-family:Georgia,"Times New Roman",serif;font-size:40px;line-height:1.1;margin:.2em 0 .1em}
.stamp{color:var(--soft);margin:0 0 24px;font-size:14px}
.stats{display:flex;flex-wrap:wrap;gap:10px;margin:0 0 28px;padding:0;list-style:none}
.stats li{background:#fff;border:1px solid var(--line);border-radius:12px;padding:10px 14px;min-width:110px}
.stats b{display:block;font-size:24px;font-family:Georgia,serif}.stats span{font-size:12px;color:var(--muted)}
.summary{background:#fff;border:1px solid var(--line);border-left:4px solid var(--copper);border-radius:12px;padding:18px 22px;margin-bottom:32px}
.summary h2{margin-top:0}.summary p{margin:.5em 0}
h2{font-family:Georgia,serif;font-size:24px;margin:36px 0 8px;border-bottom:1px solid var(--line);padding-bottom:6px}
.intro{color:var(--soft);margin:0 0 12px}
.block{margin:14px 0 18px}.block h3{margin:0;font-size:17px}.meta{margin:2px 0 4px;color:var(--sage);font-size:14px;font-weight:600}
.block p{margin:4px 0}ul{margin:6px 0;padding-left:20px}li{margin:2px 0}
footer{margin-top:40px;color:var(--muted);font-size:13px;border-top:1px solid var(--line);padding-top:12px}
@media print{body{background:#fff}main{padding:0}.summary,.stats li{break-inside:avoid}.block{break-inside:avoid}}
</style></head><body><main>
<p class="eyebrow">Cultural Elasticity · Research report · ${escape(report.origin)}</p>
<h1>${escape(report.brand)}</h1>
<p class="stamp">Generated ${escape(report.stamp.local)} · <time datetime="${report.stamp.iso}">${escape(report.stamp.iso)}</time></p>
<ul class="stats">${report.stats.map((stat) => `<li><b>${stat.value}</b><span>${escape(stat.label)}</span></li>`).join("")}</ul>
<section class="summary"><h2>Summary</h2>${report.summary.map((line) => `<p>${escape(line)}</p>`).join("")}</section>
${report.sections.map((section) => `<section id="${section.id}"><h2>${escape(section.title)}</h2>${section.intro ? `<p class="intro">${escape(section.intro)}</p>` : ""}${section.blocks.map(block).join("")}</section>`).join("\n")}
<footer>Generated by Cultural Elasticity from the research network in this browser, ${escape(report.stamp.local)}. Every number comes from Qloo; nothing in this report is a forecast.</footer>
</main></body></html>
`;
}
