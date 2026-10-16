# Qloo Technical Feasibility

Sprint 0 · Cultural Elasticity · Test case: **Jacquemus → Boutique Hospitality** · 2026-10-16

> **Read this first.** No Qloo credential was available during Sprint 0, so **live Qloo validation was not run** (`LIVE_QLOO_VALIDATION_NOT_RUN`).
> Every finding below is labelled with how it was established:
>
> - **[contract]**: read from the official harness's machine-readable workflow contract (`qloo_capabilities`, contract 1.0.0, checksum `sha256:762bdcc5…24f5`). This is authoritative for *what can be asked*.
> - **[harness]**: read from the harness 0.1.26 workflow implementation. This is authoritative for *which fields come back and how they're named*.
> - **[recorded]**: a real harness output captured during this sprint (no-credential paths only).
> - **[live]**: an actual Qloo data response. **Nothing in this document is at this level yet.**
>
> No statement here depends on mocked or synthetic data.

---

## 1. Executive Decision

### CONDITIONAL GO (contract level only, live evidence unverified)

At the contract level, the official Qloo tooling can supply most of the evidence a defensible Cultural Elasticity methodology needs:

- tag-level cultural profiles with numeric affinity;
- audience comparison between entity groups;
- single-call ranking of candidate entities against a brand;
- jointly characterizing tags for bridge discovery;
- time-series popularity.

Two of the originally proposed concepts are **not** supported as stated:

1. **Graph distance does not exist.** Qloo exposes no distance, path or topology endpoint [contract]. "Cultural distance" can only be a clearly labelled *proxy* built from overlap and affinity.
2. **Territories are not Qloo objects.** "Boutique Hospitality", "Ceramics" and "Gaming Hardware" must each be represented by a Qloo tag plus exemplar entities. That representation choice drives every downstream number.

The decision becomes **GO** only if a live run passes gates G1–G3 (§17). If G1–G3 fail, the honest answer is **NO-GO** for a Qloo-grounded product.

## 2. Environment

| Item | Value |
| --- | --- |
| Node | 22.23.2 (nvm). The machine default was 20.20.0, below the required ≥22.19, so the repo pins `.nvmrc` = 22 and `engines.node` ≥22.19.0 |
| pnpm | 10.26.0 |
| Qloo harness | `@qloo/qloo-harness` **0.1.26**, pinned exactly as a backend dependency |
| Pi runtime (inside harness) | 0.84.2 |
| Workflow contract | 1.0.0, `sha256:762bdcc5e14ff797b6de739d2658a83f78af35e68d7a5a3449455be6046924f5`, result schema `1.0-preview.1` |
| Upstream | `https://api.qloo.com` (official endpoint per `qloo doctor`), Qloo API v2.0 |
| `qloo doctor` | Qloo credential **missing**, model provider **not signed in**, endpoint trust ok, resolution provider = native |
| Live validation | **NOT RUN.** No `QLOO_API_KEY` and no harness-stored key |

## 3. Authentication

- The backend and the harness child process read `QLOO_API_KEY` from the environment. Locally it lives in `backend/.env` (gitignored). Alternatively `qloo setup` stores it in `~/.qloo`.
- `BackendConfig` exposes only `hasCredential: boolean`, never the value. The credential reaches the harness only through the child's inherited environment.
- Error messages from the transport pass through `scrubSecrets()`. The Fastify logger redacts credential-shaped fields. The feasibility script refuses to write output that contains the key.
- `pnpm check:secrets` scans tracked and untracked files and the browser bundle (`frontend/.next/static`). CI runs it after the build.
- The frontend never talks to Qloo. Its only backend variable, `BACKEND_URL`, is server-side (no `NEXT_PUBLIC_`).
- **Harness behaviour observed [recorded]:** credentials are checked before input validation. An invalid type such as `"shoe"` still returns `QLOO_AUTH` (exit 4), so input validation cannot be exercised offline.

## 4. Qloo Surfaces Tested

| Surface | What was done | Result |
| --- | --- | --- |
| `qloo explore` | Inspected (help, README, profile docs). Not driven. | Interactive and TTY-only. It also needs a model-provider login, which is absent. It is a human discovery tool, not an automation surface. **Recommended for the team's manual live session once a key exists.** |
| `qloo exec` | Integrated as the backend transport (`HarnessExecTransport`). Exercised for real without a credential. | Model-free, non-interactive, one normalized envelope per call. Exit codes: 2 input, 4 auth, 1 failure, 130 cancel [harness]. Failure output is `{error, operation, correlation_id}`, not an envelope [recorded]. **Best fit for deterministic evidence collection.** |
| `qloo api` | Inspected (`--help`). | The legacy endpoint-shaped CLI (`insights`, `search`, `entity`, `analyze`, `tags`). Useful for raw-request debugging. The harness marks it non-canonical. Not used. |
| `qloo mcp` | Started over stdio. Ran `initialize`, `tools/list`, `qloo_capabilities` and a `qloo_describe` call. | The nine canonical `qloo_*` tools plus `qloo_capabilities` work fully offline. Without a credential, calls return a structured `status:"error"`, `QLOO_AUTH`, `retryable:false` envelope [recorded]. **This is the future agent's runtime surface.** |
| `qloo doctor` / `setup --status --json` | Run. | Machine-readable readiness. The feasibility script uses it to detect a harness-stored key. |

The nine canonical workflows [contract]: `recommend`, `rank`, `describe`, `where_popular`, `compare_audiences`, `entity_tags`, `audience_demographics`, `trends`, `find_tags`.

Upstream endpoints behind them [contract]: `/search`, `/entities`, `/v2/insights` (including `filter.type=urn:tag`, `urn:demographics` and `urn:heatmap`), `/v2/analysis/compare`, `/v2/tags`, `/v2/trending`, `/v2/audiences`.

## 5. Entity Resolution

### Jacquemus

**Live result: unverified.**

What is established:

- `describe` resolves a name through `/search` with `types=urn:entity:brand` and `take: 5`, then hydrates through `/entities` [harness].
- Outcomes are explicit:
  - **resolved** when exactly one exact normalized-name match exists (`match: "exact"`);
  - **ambiguous** with up to five candidates;
  - **not_found**.

  The last two surface as `status: "needs_input"`. The harness never auto-picks between ambiguous candidates [harness].
- Returned metadata is restricted to: `entity_id`, `name`, `type`, `subtype`, `popularity`, plus `description`, `short_description`, `image`, `geocode`, `address`, `price_level` and `business_rating` when present [harness]. There is **no confidence score**, and the harness explicitly refuses to relabel popularity or order as confidence.
- **Ambiguity risk:** "Jacquemus" is both the brand and the designer (Simon Porte Jacquemus). Scoping `describe` to `type: brand` should isolate the brand. Whether a separate `person` entity exists is a live question.
- Our client treats `needs_input` as blocking. The feasibility run stops (status `BLOCKED`, gate G1 fails) rather than choosing.

### Boutique Hospitality

**Live result: unverified.**

Qloo has no "category" or "territory" object [contract]. The available representations are:

| Representation | Mechanism | Usable for |
| --- | --- | --- |
| **Tag** (e.g. a boutique-hotel tag URN) | `find_tags` semantic search over the tag ontology. It returns tag URNs in rank order with no confidence [harness]. | Filters and signals in `recommend` and `rank`. **Not accepted** by `compare_audiences`, `entity_tags` or `audience_demographics`, which take entities only [contract]. |
| **Exemplar entities** (hotels as `place` entities) | `recommend` with `target_type: place`, `signal_tags = include_tags = [tag]` | Everything that needs entities: audience comparison, tag profiles, trends. |
| **Brand-conditioned territory** | `recommend` with `target_type: place`, `signals = [Jacquemus]`, `include_tags = [tag]` | Which hospitality entities the Jacquemus audience over-indexes on. |

**Selected representation:** tag + exemplars. Specifically:

1. Run `find_tags` for all five phrasings ("Boutique Hospitality", "Boutique Hotel", "Luxury Hospitality", "Hospitality", "Hotels") and record every candidate.
2. Take the first candidate of the first non-empty phrasing as the tag. Mark it `auto_selected_unconfirmed` and list the alternatives in the packet. **A human must pin the tag** (`pinnedTagId` in `backend/src/feasibility/config.ts`) before results are relied on.
3. Use the top 10 `place` entities for that tag as exemplars, deliberately **not** conditioned on Jacquemus to avoid circularity.

Open live questions:

- Does a boutique-hotel tag exist, and is it scoped to places? (The harness scopes tags locally to the target type when parent metadata allows [harness].)
- Do "Luxury Hospitality" and "Hotels" map to different tags, meaning they are distinct territories rather than synonyms?

## 6. Cultural Profile Evidence

The following [contract]/[harness] evidence is available per entity:

| Evidence | Workflow | Shape | Notes |
| --- | --- | --- | --- |
| Characterizing tags | `entity_tags` (Insights `filter.type=urn:tag`) | `{id, name, type, popularity?, affinity?}`, ≤20 per call [harness] | **Primary profile evidence.** Accepts 1–10 entities and returns tags that *jointly* characterize them. |
| Related entities | `recommend` with `signals=[entity]` | `{entity_id, name, type, subtype, popularity?, affinity?}`, ≤20, optional explainability [harness] | Cross-domain neighbours (brands, places, artists…). |
| Demographics | `audience_demographics` (`urn:demographics`) | **Untyped**, passed through [harness] | Documented by Qloo as "documented-but-not-enumerated" [contract]. Stored as opaque evidence. |
| Momentum | `trends` (`/v2/trending`) | **Untyped** `series[{entity, points[]}]` [harness] | Entity-level only, 1–5 entities per call, ISO date range. |
| Geography | `where_popular` (heatmap) | Untyped | Not needed for Sprint 0, so not wrapped. |
| Scores | `affinity`, `popularity` | Numbers [harness] | **Query-relative.** Comparable only within one call. |

For the target, the same evidence is collected over the exemplar set (`entity_tags` jointly over up to 10 exemplars).

## 7. Audience Comparison

`compare_audiences` [contract]:

- **Input:** `group_a` and `group_b`, each 1–10 **entities** (no tags), optional `target_type` and `limit` ≤20.
- **Upstream:** `/v2/analysis/compare` with `a.signal.interests.entities` and `b.signal.interests.entities`.
- **Output:** `results` is the raw upstream payload, **passed through untyped** [harness].

So:

- **Output schema: unknown until live.** We store it as `OpaqueEvidence` with its top-level keys and the paths of numeric fields, and interpret nothing.
- **Quantitative scores: unknown.** Gate G4 checks whether any numeric field exists.
- **Limitation:** Boutique Hospitality enters only through its exemplars, so the comparison is "Jacquemus vs. these 10 hotels", not "vs. the territory".
- **Can it support Audience Adjacency?** **Possibly, if** G4 shows per-entity or per-tag comparative scores *and* Qloo documents their meaning. Without documented semantics we must not treat any number as an overlap percentage.
- **Fallback that is already well-defined:** affinities from the brand-conditioned territory call (§5). These are numeric, per entity and single-call comparable [harness].

## 8. Candidate Ranking

`rank` [contract]:

- ranks 1–10 **entities of one `option_type`** against a shared signal profile;
- requires at least one entity, location or demographic signal;
- the contract states: **"Scores from separate calls are not comparable."**

The harness restricts `/v2/insights` to the supplied IDs (`filter.results.entities`) and returns each option's `affinity` and `popularity` [harness].

Consequences:

- Abstract territories ("Ceramics", "Sailing Experience") **cannot be ranked directly**.
- The viable design: one human-chosen **exemplar brand per territory**, all ranked in **one call** with Jacquemus as the signal.

  | Territory | Exemplar brand (assumption) |
  | --- | --- |
  | Boutique Hotel | Ace Hotel |
  | Ceramics | Astier de Villatte |
  | Furniture | HAY |
  | Sailing Experience | North Sails |
  | Wellness Retreat | Six Senses |
  | Gaming Hardware | Razer |

- Exemplars that are ambiguous or not found are **excluded and reported**, not guessed (tested).
- **Recorded assumptions:**
  - the exemplar stands in for the territory, so a different exemplar could change the order;
  - all six must be Qloo `brand` entities;
  - affinities are comparable only within this call (`comparableWithinCorrelationId`).

**Can it distinguish plausible from weak territories?** Mechanically yes. Validity rests on exemplar choice, which is a methodological risk (§14). A more robust variant for Sprint 1: rank *several* exemplars per territory in one call (the call takes ≤10 options) and compare distributions rather than single points.

## 9. Bridge Discovery

**Qloo exposes no graph paths** [contract]. The supported output is therefore:

> **Qloo-supported intermediate cultural signals**

It is produced from two pieces of evidence:

1. **Shared tags:** tag IDs that appear in both the brand's and the target's top-N `entity_tags` lists.
2. **Joint tags:** `entity_tags` called on {Jacquemus + up to 3 target exemplars} at once. Qloo returns tags that jointly characterize the combined set [contract: "concepts that jointly characterize one or more entities"].

The same procedure runs for Jacquemus → Gaming Hardware (exemplar: Razer) as a deliberately distant contrast.

What **cannot** be claimed:

- that a tag lies "between" the two in any topological sense;
- path length;
- that a joint tag is causal or directional.

The joint call is also asymmetric: one brand versus up to three exemplars. The `BridgeEvidence` contract hard-codes `semantics: "qloo_supported_intermediate_cultural_signals"`, and the schema rejects any other value.

## 10. Cultural Distance

**Does Qloo expose real graph distance? No.**

The complete set of upstream GET paths in the pinned specification is `/`, `/entities`, `/search`, `/v2/analysis/compare`, `/v2/audiences`, `/v2/audiences/types`, `/v2/insights`, `/v2/tags`, `/v2/tags/types`, `/v2/trending` [contract]. None returns a distance, path or topology. No workflow returns one either. Qloo's scores are affinities (query-relative association strength), not metric distances.

**What defensible proxy is possible:** a *Qloo-derived Cultural Distance Proxy*, explicitly labelled as such, assembled from:

| Ingredient | Source | Status |
| --- | --- | --- |
| Tag-set overlap (shared count, Jaccard on top-N lists) | `entity_tags` brand vs. target | Computed in Sprint 0 (descriptive only). Depends on live data. |
| Single-call rank position and affinity of the territory exemplar | `rank` | Collected. Depends on live data. |
| Affinity of territory entities to the brand | brand-conditioned `recommend` | Collected. Depends on live data. |
| Audience comparison fields | `compare_audiences` | Depends on output semantics (G4). |
| Bridge availability (joint and shared tag count) | `entity_tags` joint | Collected. Depends on live data. |

Constraints on any proxy:

- it may only combine numbers from the **same call** or rank-based (ordinal) transforms;
- it must not be called "distance" in the UI without the word "proxy";
- it must expose its ingredients;
- weights are out of scope until live data shows the ingredients' ranges and stability.

## 11. Candidate Elasticity Dimensions

| Dimension | Supported? | Qloo evidence | Confidence | Notes |
| --- | --- | --- | --- | --- |
| Cultural Coherence | **Partially** | `entity_tags` (brand vs. exemplars): shared tags and affinity | Medium (contract), unverified live | Depends on the target representation, and the 20-tag cap truncates profiles. Gates G3 and G6. |
| Audience Adjacency | **Conditional** | `compare_audiences` (untyped); brand-conditioned `recommend` affinities | Low–Medium | The compare output schema is unknown (G4). The recommend affinities are a well-defined fallback. |
| Novelty | **Not supported as an independent dimension** | No direct signal. `popularity` measures how mainstream something is, not novelty. Low overlap is just the inverse of coherence. | Low | Drop as an independent dimension, or redefine (e.g. a territory where the brand's audience over-indexes but the brand has no tag presence). Needs live data to test. |
| Bridge Strength | **Partially, renamed** | Joint and shared `entity_tags` | Medium (contract) | Must be reported as "Qloo-supported intermediate cultural signals", not paths. Gate G6. |
| Cultural Distance Proxy | **Proxy only** | Overlap + single-call rank + affinities | Medium (contract) | **No real graph distance** (§10). |
| Cultural Momentum | **Supported for entities** | `trends` time series | Low–Medium | Output untyped until live. Territories only via exemplars (≤5 per call). |

## 12. Proposed Evidence Model

Implemented in `backend/src/contracts/qloo.ts` as strict zod schemas, validated at the boundary. Unknown fields such as `elasticityScore` or `confidence` are rejected by tests.

```
EvidencePacket (schemaVersion "0.1", evidenceSource "live" | "fixture", harness {version, contractChecksum})
├── brand: CulturalProfile
│   ├── subjects: ResolvedConcept[]       kind, input, label, qlooId, type, match,
│   │                                     confirmation (unambiguous | auto_selected_unconfirmed | pinned),
│   │                                     alternatives, provenance
│   ├── tags: CulturalSignal[]            qlooId, label, affinity?, popularity?, sourceCorrelationId
│   ├── relatedEntities?, demographics? (OpaqueEvidence), momentum? (OpaqueEvidence)
├── target
│   ├── representation: label, tagCandidates[] (per phrasing), selectedTag, exemplars[], exemplarMethod
│   └── profile?: CulturalProfile over the exemplars
├── targetAffinityToBrand?   territory entities ranked by affinity to the brand (one call)
├── audienceComparison?      groupA, groupB, result: OpaqueEvidence (shape "unverified", topLevelKeys, numericFieldPaths)
├── rankings?: CandidateRanking[]   entries (territory, exemplarInput, exemplar?, position?, affinity?,
│                                   unresolvedReason?), comparableWithinCorrelationId, assumptions
├── bridgeEvidence?: BridgeEvidence[]   semantics (fixed literal), sharedTags, jointTags, overlap (descriptive)
├── limitations: string[]
└── provenance: ProvenanceRef[]   operation, correlationId, status, endpoint, requests (IDs/URNs only),
                                  warnings, degraded, partial
```

Design rules embodied in the model:

- every number carries the correlation ID of the call it came from;
- untyped Qloo outputs stay opaque;
- human assumptions (tag choice, exemplars) are explicit fields;
- there is no score field anywhere.

## 13. Preliminary Elasticity Methodology

No weights and no formula. These are the measurable ingredients that appear viable, subject to live gates:

1. **Grounding.** Brand resolved unambiguously (G1). Territory = human-pinned tag + Qloo-returned exemplars (G2).
2. **Coherence ingredients.** Brand tag profile vs. territory tag profile: shared tags, overlap on top-N lists, affinity of shared tags (G3, G6).
3. **Adjacency ingredients.** Affinity of territory entities to the brand in one call. `compare_audiences` fields, if G4 shows documented quantitative semantics.
4. **Relative stretch.** Single-call rank of territory exemplars against the brand. Ordinal positions are safer than raw affinities (G5).
5. **Bridge ingredients.** Joint and shared tags, reported as named cultural signals for the agent to interpret (G6).
6. **Momentum context.** Entity trends, as context rather than a scored dimension.

Methodological rules carried forward:

- ordinal comparisons within one call only;
- every ingredient is shown alongside the score that later combines them;
- the deterministic engine computes, and the LLM only interprets.

## 14. Limitations

1. **Live validation was not run.** Every live behaviour is unverified (the list is printed by `pnpm feasibility:qloo`).
2. **No graph distance or paths** in Qloo [contract].
3. **Affinity is query-relative.** There is no cross-call comparability [contract for rank, harness for all].
4. **Territories are constructed.** Tag choice and exemplar choice are judgement calls that drive results. The tag auto-selection is a placeholder that requires human confirmation.
5. **Untyped outputs:** `compare_audiences`, `audience_demographics`, `trends` [harness].
6. **Top-20 caps** on every list workflow [contract], so overlap measures are computed on truncated lists.
7. **The 10-entity cap** on signal groups, options and joint-tag inputs [contract].
8. **Joint-tag asymmetry** (1 brand vs. N exemplars).
9. **Ranking single exemplars** conflates the exemplar with the territory.
10. **No confidence values anywhere.** Resolution is exact, ambiguous or not found [harness].
11. **Harness preview status.** The result schema is `1.0-preview.1`, and the contract may change. The client pins the schema version and checksum and rejects mismatches.
12. **Runtime weight.** The harness ships a full agent runtime (the backend container is 529 MB).

## 15. Qloo Necessity Assessment

**Would this concept materially weaken without Qloo? Yes.** Without Qloo, every dimension would be one of two things:

- **LLM judgement:** an LLM's opinion of whether Jacquemus "fits" hospitality. This is unfalsifiable, non-reproducible and exactly what AGENTS.md forbids for core scores.
- **Hand-built proxies:** social listening and co-mention scraping. These are out of scope, slow, and noisy.

Qloo uniquely provides cross-domain affinity (fashion brand → hotels, ceramics brands, gaming hardware) from one consistent taste graph, with stable IDs and provenance. That is the only reason the core question can be answered with *measured* rather than *asserted* evidence.

The contract findings narrow the claim, but do not remove the dependence: Qloo supplies association evidence, not distances.

## 16. Architecture Recommendation

- **Keep the hybrid workflow-agent design**, with one change in emphasis: **deterministic evidence collection is a fixed workflow**, not agent free-play. Sprint 0's `runFeasibility` is the prototype of that workflow. The agent, later, chooses *which* territories and exemplars to investigate and interprets the packet. It never produces numbers.
- **Transport:** keep `QlooTransport` as the seam.
  - `qloo exec` (implemented) suits batch and CLI collection.
  - For the backend service and agent runtime, add a **`qloo mcp` stdio transport** (same envelope, long-lived process, no per-call spawn cost).
  - Both run only in a container-capable backend.
- **Never call Qloo from the frontend**, and never assume serverless compatibility for the harness process.
- **Contracts:**
  - promote `OpaqueEvidence` fields to typed contracts **only after** live responses are recorded;
  - store sanitized live packets under `evals/fixtures/live/` as regression evidence.

## 17. Go / Conditional-Go / No-Go

**CONDITIONAL GO.** Viable at the contract level, unverified against live Qloo.

| Gate | Requirement (checked automatically by `pnpm feasibility:qloo`) | If it fails |
| --- | --- | --- |
| **G1** | Jacquemus resolves unambiguously to a brand entity | **NO-GO** for this test case (choose a different hero brand) |
| **G2** | A hospitality tag exists and yields ≥5 place exemplars | **NO-GO** for this territory (re-scope the target) |
| **G3** | Jacquemus has ≥10 tags with numeric affinity | **NO-GO**: no profile evidence, so coherence is unsupported |
| G4 | `compare_audiences` returns numeric fields | Audience Adjacency falls back to brand-conditioned affinity |
| G5 | One rank call returns affinity for ≥4 exemplars | The ranking design needs rework |
| G6 | Brand + territory joint tags are non-empty | Bridge Strength is unsupported |

G1–G3 passing → **GO**. Any of G1–G3 failing → **NO-GO** as currently scoped. G4–G6 decide which dimensions survive.

## 18. Sprint 1 Recommendation

**Exact next task:** obtain the hackathon credential and run `pnpm feasibility:qloo` live. Then:

1. Evaluate gates G1–G6 and update §1 and §17 of this document with **[live]** findings.
2. Review the hospitality tag candidates and **pin** the target tag in `backend/src/feasibility/config.ts`. Re-run.
3. Record the real `compare_audiences`, `audience_demographics` and `trends` output shapes. Replace their `OpaqueEvidence` with typed contracts and add normalizer tests against the recorded (sanitized) payloads.
4. Commit the reviewed, sanitized packet to `evals/fixtures/live/`.

Only after G1–G3 pass: implement the deterministic **ingredient calculator**. This is a pure function from `EvidencePacket` to named, ordinal, single-call-scoped ingredients, without weights or a composite score.
