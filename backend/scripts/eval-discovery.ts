/**
 * Sprint 10A discovery evaluation, suite R (docs/sprint-10a/PREREGISTRATION.md §3). Offline: no provider call.
 *
 *   R1–R3  the frontier-pool/v2 rule applied to real recorded Qloo candidate pools (evals/discovery/recorded), against
 *          the v1 support order those runs used
 *   R4     discovery seeds from the real Loewe baseline scan, each traced to the scan's own provenance
 *   H      a blinded rating sheet (arms hidden, order seeded) for the owner; never scored here
 *
 * Mechanism and safety evidence on real data, not a discovery-quality result: the pools were cut to 12 by the v1 order
 * before they were recorded, and they come from 2 brands. Writes docs/sprint-10a/evaluation/.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import type { BrandBaselineResult } from "@cultural-elasticity/shared";
import { discoverySeeds } from "../src/api/baseline-handoff.js";
import { orderFrontierPool } from "../src/agent/frontier.js";
import { tagFacet, tagRole } from "../src/methodology/tag-facets.js";

const root = new URL("../../", import.meta.url);
const read = <T>(path: string) => JSON.parse(readFileSync(new URL(path, root), "utf8")) as T;
const TOP = 6;
const SEED = 10_2026;

type RecordedEntry = { canonicalConceptKey: string; tagId: string; label: string; support: number };
type RecordedPool = { id: string; brand: string; candidatePool: RecordedEntry[]; runs: { runId: string; model: string; chosen: string[] }[] };

const annotate = (e: RecordedEntry) => {
  const facet = tagFacet(e.tagId);
  return { ...e, facet, facetRole: facet ? tagRole(facet) : null };
};
const namespaces = (list: readonly { facet: string | null }[]) => new Set(list.map((e) => e.facet ?? "?")).size;
const keywordShare = (list: readonly { facetRole: string | null }[]) => (list.length ? Math.round((list.filter((e) => e.facetRole === "DESCRIPTIVE_KEYWORD").length / list.length) * 100) / 100 : null);

function mulberry32(seed: number) {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const { pools } = read<{ pools: RecordedPool[] }>("evals/discovery/recorded/pools.live.json");
const random = mulberry32(SEED);
const perPool = pools.map((pool) => {
  const v1 = pool.candidatePool.map(annotate);
  const v2 = orderFrontierPool(v1);
  const v1Top = v1.slice(0, TOP);
  const v2Top = v2.slice(0, TOP);
  const bestTaxonomy = v1.find((e) => e.facetRole !== "DESCRIPTIVE_KEYWORD");
  const sameEntries = v2.length === v1.length && v2.every((e) => v1.some((x) => x.tagId === e.tagId && x.label === e.label && x.support === e.support));
  return {
    id: pool.id,
    brand: pool.brand,
    runs: pool.runs.length,
    models: [...new Set(pool.runs.map((r) => r.model))],
    chosenInRecordedRuns: [...new Set(pool.runs.flatMap((r) => r.chosen))],
    v1Top: v1Top.map((e) => `${e.label} (${e.facet}, ${e.support})`),
    v2Top: v2Top.map((e) => `${e.label} (${e.facet}, ${e.support})`),
    R1: !bestTaxonomy || v2Top.some((e) => e.tagId === bestTaxonomy.tagId),
    R2: namespaces(v2Top) >= namespaces(v1Top),
    R3: sameEntries,
    namespacesTop: { v1: namespaces(v1Top), v2: namespaces(v2Top) },
    keywordShareTop: { v1: keywordShare(v1Top), v2: keywordShare(v2Top) },
    blind: random() < 0.5 ? { A: "v1", B: "v2" } : { A: "v2", B: "v1" },
    lists: { v1: v1Top, v2: v2Top },
  };
});

const loewe = read<{ result: BrandBaselineResult }>("docs/sprint-9b1/evidence/loewe-canary-2.derived-0.2.json").result;
const seeds = discoverySeeds(loewe);
const known = new Set(loewe.fingerprint.provenance.map((ref) => `${ref.correlationId}\0${ref.sourceId}`));
const R4 = seeds.length > 0 && seeds.every((seed) => known.has(`${seed.correlationId}\0${seed.id}`) && loewe.fingerprint.signals.some((s) => s.id === seed.id && s.kind === "entity"));

const criteria = {
  R1: { passed: perPool.filter((p) => p.R1).length, of: perPool.length },
  R2: { passed: perPool.filter((p) => p.R2).length, of: perPool.length },
  R3: { passed: perPool.filter((p) => p.R3).length, of: perPool.length },
  R4: { passed: R4 ? 1 : 0, of: 1 },
};
const allPassed = Object.values(criteria).every((c) => c.passed === c.of);
const report = {
  notice: "OFFLINE replay on real recorded Qloo evidence (suite R). Mechanism and safety evidence only: not a discovery-quality result, not live Qloo or live model validation.",
  preregistration: "docs/sprint-10a/PREREGISTRATION.md",
  denominators: { pools: perPool.length, independentBrands: new Set(perPool.map((p) => p.brand)).size, loeweSeeds: seeds.length },
  criteria,
  result: allPassed ? "PASS" : "FAIL",
  pools: perPool.map(({ lists: _lists, blind: _blind, ...rest }) => rest),
  loewe: { scanId: loewe.scanId, origin: loewe.execution.recordedOrLive, directions: loewe.territories.map((t) => t.name), seeds: seeds.map((s) => ({ label: s.label, domain: s.domain, correlationId: s.correlationId })) },
  limitations: [
    "The recorded pools were cut to 12 entries by the v1 support order before they were stored, so concepts v2 might have kept from beyond those 12 are not observable here.",
    "Two independent brands (Oatly, Allbirds), two pools each: far too few to establish a discovery-quality change.",
    "R2 is satisfied by construction (v2 interleaves facets); it checks the mechanism, not quality.",
    "Brand profiles were not stored with the pools, so domainRelation cannot be computed in this replay.",
    "Suite H (human rating) and the frozen holdouts are NOT_RUN.",
  ],
};

const out = new URL("docs/sprint-10a/evaluation/", root);
mkdirSync(out, { recursive: true });
writeFileSync(new URL("report.json", out), `${JSON.stringify(report, null, 2)}\n`);
const sheet = [
  "# Sprint 10A blinded rating sheet (Suite H)",
  "",
  "For the owner or another human rater. Each pool shows two candidate lists, A and B, from real recorded Qloo evidence. Which engine produced which list is in `rating-key.json`. Do not open it before rating. Rate every direction on both scales, from the evidence shown here only.",
  "",
  "- **Non-obviousness.** 1 = restates the familiar identity. 2 = familiar adjacency. 3 = somewhat less obvious but understandable. 4 = a distinctive cross-domain opportunity. 5 = highly surprising, culturally coherent and worth investigating.",
  "- **Cultural relevance.** 1 = an incidental attribute or demographic label. 3 = a plausible cultural territory. 5 = a clearly meaningful cultural territory.",
  "",
  "This is a human judgment scale, not a Qloo measure. Each entry shows the Qloo tag facet and how many of the brand's related brands carry it.",
  "",
  ...perPool.flatMap((p, i) => [
    `## Pool ${i + 1}: ${p.brand}`,
    "",
    ...(["A", "B"] as const).flatMap((side) => [
      `### List ${side}`,
      "",
      "| Direction | Facet | Related brands carrying it | Non-obviousness (1–5) | Relevance (1–5) |",
      "| --- | --- | --- | --- | --- |",
      ...p.lists[p.blind[side] as "v1" | "v2"].map((e) => `| ${e.label} | ${e.facet} | ${e.support} |  |  |`),
      "",
    ]),
  ]),
].join("\n");
writeFileSync(new URL("rating-sheet.md", out), `${sheet}\n`);
writeFileSync(new URL("rating-key.json", out), `${JSON.stringify({ seed: SEED, pools: perPool.map((p, i) => ({ pool: i + 1, id: p.id, ...p.blind })) }, null, 2)}\n`);

console.log(report.notice);
for (const p of report.pools) console.log(`  ${p.id} ${p.brand}: R1 ${p.R1 ? "PASS" : "FAIL"}  R2 ${p.R2 ? "PASS" : "FAIL"} (namespaces in top ${TOP}: v1 ${p.namespacesTop.v1}, v2 ${p.namespacesTop.v2})  R3 ${p.R3 ? "PASS" : "FAIL"}  keyword share v1 ${p.keywordShareTop.v1} → v2 ${p.keywordShareTop.v2}`);
console.log(`  Loewe seeds: ${seeds.length} (${seeds.map((s) => s.label).join(", ")}) R4 ${R4 ? "PASS" : "FAIL"}`);
console.log(`RESULT: ${report.result} (suite R; H and holdouts NOT_RUN)`);
if (!allPassed) process.exitCode = 1;
