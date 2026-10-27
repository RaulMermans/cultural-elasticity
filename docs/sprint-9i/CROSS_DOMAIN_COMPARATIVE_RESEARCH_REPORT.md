# Sprint 9I — Cross-domain cultural intelligence and end-to-end comparative research

**Date:** 2026-10-27
**Branch:** `sprint/9i-cross-domain-cultural-intelligence`
**Starting SHA:** `fc93750c3e909178bd641ca77723394ee95b7817` (`origin/main`, Sprint 9H merged as PR #32). Rebased before the PR onto `c9293c3` (PRs #33 fail-closed admission and #34 release guardrails).

**Evidence posture:**

- `LIVE_QLOO_VALIDATION_NOT_RUN` and `LIVE_AGENT_MODEL_VALIDATION_NOT_RUN` for the new comparative path. No new paid call was made.
- A bounded live request is prepared in [LIVE_VALIDATION_REQUEST.md](LIVE_VALIDATION_REQUEST.md); it is not authorized.

## Outcome in one paragraph

The comparison functions from Sprint 9H are now on a real production path. That path runs from a completed single-direction investigation, through server-offered references and a server-side eligibility gate, to an explicit authorization and a governed `compare_territories` job in the existing runtime. The finished job is checked against the authorized plan, and the user gets a validated report, a cross-domain relationship map and an exported brief.

The weakness from Sprint 9H is fixed. A reference type is now Qloo evidence held by the server: it is never declared by the caller and never copied from the target.

Cross-domain relationships are projected from what Qloo and the agent actually observed. Each one is labelled as observed, computed, or interpretation, and none can enter a ranking.

The complete journey is proven end to end on the synthetic world through the real API routes and in the browser. The stored live evidence supports only part of the journey (Loewe), and the product stops honestly at that boundary.

## 1. Starting SHA and branch

- Starting SHA: `fc93750`. Rebased onto `c9293c3`.
- Conflicts were in `comparative-bridge.ts` and its 9H test. #33's evidence-origin fix is subsumed by the rewrite, and its three-origin assertions are kept in test 14.
- Development branch: `sprint/9i-cross-domain-cultural-intelligence`.
- Working copy: a fresh clone outside iCloud. The iCloud copy on Desktop had been evicted and could not be read; see the open risks.

## 2. End-to-end architecture

```
Brand scan (baseline, token) ──► Directions / proposed direction
        │
        ▼
POST /api/agent/handoff/jobs ── single_hypothesis_v1 job (existing runtime, Haiku) ──► completed result
        │                                   (server records job → scan ownership)
        ▼
POST /api/agent/handoff/compare/options   x-baseline-token + x-job-token
        │  server re-reads: scan (token), parent job (token), sibling jobs of the same scan,
        │  parent run state (exemplar tag profiles)
        │  → collectReferenceCandidates  (completed investigations · target exemplar profile tags · baseline directions)
        │  → projectCulturalConnections  (DIRECT / DERIVED / INTERPRETATION, rankable:false)
        ▼
POST /api/agent/handoff/compare/preview   { referenceIds }            no provider call
        │  → assessComparisonEligibility (brand, target representation, provenance, type evidence,
        │                                 duplicates, exemplar overlap, cardinality 3–6)
        ▼
explicit authorization in the UI (limits from the server: 32 Qloo calls, 12 turns, Haiku, 20 min, reserve)
        ▼
POST /api/agent/handoff/compare/jobs      { referenceIds, idempotencyKey }
        │  idempotency → eligibility → admitCreate (paid admission) → spend reservation
        │  → JobManager → QueryService → AgentRuntime.run(compare_territories, expectedBrandId)
        ▼
GET /api/agent/jobs/:id                    progress, failure states
        ▼
GET /api/agent/handoff/compare/:id/report  validateComparativeOutcome(plan, result)
        │                                  → projectComparativeStrategicReport (ce-comparative-report/0.2)
        ▼
ComparativeReportView → research brief (on screen and HTML export, same sections)
```

The browser talks only to Next.js routes (`/api/research/compare/*`), which proxy to the backend. Tokens travel in headers, never in URLs.

## 3. Dead-code and disconnected-component inventory (as found)

| Component (Sprint 9H) | Found | Now |
| --- | --- | --- |
| `assessComparisonEligibility` | Called only by tests | Production gate on `/compare/preview` and `/compare/jobs` (rewritten) |
| `buildComparativeHandoffRequest` | Tests only | Builds the job request on `/compare/jobs` |
| `projectComparativeStrategicReport` | Tests only; silently fell back to `territories[0]`, "Unknown Brand", and mapped recorded results to `synthetic` | Report endpoint; takes the server plan and verdict; preserves origin; no fallbacks |
| `suggestReferenceTerritories` | Tests only; gave every suggestion the **target's** type | Removed; replaced by `collectReferenceCandidates` (evidence-typed) |
| `buildComparativeBaselineInvestigationRequest` (`baseline-handoff.ts`) | Tests only; references by label, no type or representation check | Removed with its `HandoffError` codes |
| `QueryAlreadyExecutedError` duplicate class in the bridge | Separate class from the query layer's | Re-export of the single class |
| "Comparative Research Handoff (Optional)" block in `DeepResearchPanel` | Informational, no action | Replaced by `ComparativeResearchPanel` |
| `ComparisonEligibility` / `ComparativeStrategicReport` shared types | Used by dead code only | In use; report bumped to 0.2 |
| FULL table inside `DeepResearchPanel` | Unreachable for `single_hypothesis_v1` (references are never added) | Left unchanged (harmless); comparison results render in the new panel |

## 4. Integrations implemented

- **Backend** ([agent.ts](../../backend/src/api/agent.ts)):
  - four comparative routes;
  - a job-to-scan ownership map;
  - a comparative plan per job;
  - idempotent starts;
  - an injectable `BaselineReader` (tests, and the e2e fixture builder).
- **Job manager:** a server-only `peek(id)`, used for sibling jobs of the authorized scan. The clock is now read through a closure; production behaviour is unchanged.
- **Shared** ([agent.ts](../../packages/shared/src/agent.ts), [connections.ts](../../packages/shared/src/connections.ts)):
  - candidate, eligibility, outcome-check and report 0.2 types;
  - the relationship projection.
- **Frontend:**
  - [ComparativeResearchPanel.tsx](../../frontend/src/components/research/ComparativeResearchPanel.tsx): reference selection, server check, authorization, progress and failure states, report, connections;
  - [RecordedComparativeDemo.tsx](../../frontend/src/components/research/RecordedComparativeDemo.tsx);
  - proxies under `frontend/src/app/api/research/compare/`;
  - the brief ([research-summary.ts](../../frontend/src/lib/research-summary.ts)) now includes the comparison and relationship sections, and the export renders the same text.

## 5. Reference-validation corrections

| Requirement | Enforcement |
| --- | --- |
| Confirmed canonical brand | `resolution === "confirmed"`, and the parent result brand must equal the scan's `qlooId` (`BRAND_MISMATCH`, 409) |
| Valid target representation with provenance | `representationProblem`: rankable type, ≥ 2 distinct exemplar ids, no repeated id, not `INSUFFICIENT_EVIDENCE`, ≥ 1 correlation id |
| Source-grounded reference before ranking | A completed investigation's validated representation, or Qloo tag-profile membership; `REFERENCE_UNGROUNDED` when unsourced or degraded. The runtime re-validates representations before its rank call |
| Compatible types, verified by the server | `typeEvidence` from server-held evidence only; `REFERENCE_TYPE_UNVERIFIED`; `INCOMPATIBLE_ENTITY_TYPES` with a qualitative-evidence instruction |
| No type taken from the target | Removed (`ref.entityType ?? targetEntityType` in 9H) |
| Distinct concepts | Label and concept-id duplicates → `DUPLICATE_TERRITORIES` |
| Legitimate, diverse exemplars; no duplicate manipulation | `DUPLICATE_EXEMPLARS` for a repeated id or one entity representing two territories |
| Compatible ranking capability | Rankable Qloo types only; panel cap 6, minimum 3 (unchanged) |
| Paid authorization at dispatch | `admitCreate` (admissions) and spend reservation on `/compare/jobs`; the runtime's per-call spend bound |
| Browser cannot supply evidence | Strict body schema (ids only); unknown reference ids → `reference_not_offered` (422) |
| Finished run matches the plan | `validateComparativeOutcome`: brand, target present, single panel and type, representation, sources, classification needs a numeric position, concept anchor |

A real defect was found while testing: when every rank call fails, the runtime emits `relativePosition: { position: null, of: 0 }`, not `null`. The checks therefore treat only a numeric `position` as ranked.

## 6. Cross-domain discovery capabilities

- `projectCulturalConnections` covers brands, places, artists, films, books and tags. It draws on the brand-conditioned baseline lists, tag membership of exemplars, brand-and-tag-conditioned lists, coherence overlaps, and validated model interpretation.
- It is bounded: at most 5 per domain and source call, in Qloo order, which is not a ranking.
- An empty overlap is stated as a note. It is not hidden, and it is not filled with something else.

**Not added:** a new agent skill, operation or exploration loop. The existing runtime already chooses tools and entity types from evidence (probe policy v2). Cross-domain discovery here is grounded projection plus evidence-typed reference selection. No new Qloo operation was needed (the registry was audited: `qloo_resolve_entity`, `qloo_find_tags`, `qloo_get_entity_tags`, `qloo_recommend`, `qloo_related_entities`). An agent-led exploration step would need its own live validation. That is deliberately left out under the sprint's final principle.

## 7. Cultural relationship examples (recorded live Loewe evidence)

| Kind | Relationship | Source |
| --- | --- | --- |
| Observed by Qloo | Boutique Hospitality (tag) → Casa Art Hotel, Hotel Ritta Höppner, MonkBridge House (places) | `mcp-c4e2eb37-…` |
| Observed by Qloo | Loewe + Boutique Hospitality → J.K. Place Capri, Hôtel de NELL, Palazzo Dama… (places, brand-conditioned) | 9G conditioned call |
| Observed by Qloo | Loewe → Call Me by Your Name, Phantom Thread (films); BLACKPINK (artist); *Dapper Dan: Made in Harlem* (book) | baseline recommend calls `mcp-b28f8a65-…`, `mcp-ce00a0ca-…`, `mcp-f29089dc-…` |
| Computed overlap | **None.** No non-operational tag is shared by Loewe's profile and the compared hotel profiles (2 compared) | stated as a note |
| Agent interpretation | Loewe → Boutique hospitality: the validated 9G Haiku synthesis (passed the claim validator on its 2nd attempt) | labelled interpretation |

The chain "Loewe → Artistic Exploration → Design-led Hospitality → Places" from the brief is **not** a Qloo result and is not shown.

## 8. Comparative results and provenance

- **Synthetic (test world, not Qloo).** Larkspur Velo, Gravel Riding vs Alpine Hiking and Mountain Town (one place panel):
  - Mountain Town 1/3, `NATURAL_ADJACENCY`;
  - Alpine Hiking 2/3, `CREDIBLE_STRETCH`;
  - Gravel Riding 3/3, `CULTURAL_BREAK`.
  
  All outcome checks passed. This proves the pipeline; it is not a cultural finding.
- **Recorded live (Loewe):**
  - no comparison is possible from stored evidence;
  - the gate returns `REFERENCE_TYPE_UNVERIFIED` (Model and Fashion are tag-only directions; the 9G record keeps no exemplar profiles);
  - `recorded-comparative.json` records the refusal with source SHA-256 checksums, and a test re-verifies them.
- **Live:** not run. See [LIVE_VALIDATION_REQUEST.md](LIVE_VALIDATION_REQUEST.md): at most 75 Qloo calls and $1.60 reserved, against a requested $2.00 cap.

## 9. Recorded versus live versus synthetic

| Artifact | Label | Origin |
| --- | --- | --- |
| `frontend/src/demo/recorded-comparative.json` | `RECORDED_COMPARATIVE_DEMO`, `evidenceOrigin: live` sources, connections `recorded` | Built offline from `docs/sprint-9g/evidence/…live.json` and the recorded Loewe baseline |
| `backend/tests/fixtures/synthetic/comparative-e2e.json` | `fixtureType: synthetic` | Recorded from the real backend routes over the synthetic world |
| Report `evidenceOrigin` | Passed through from the run | Sprint 9H mapped `recorded` to `synthetic`; fixed and tested |
| UI badges | "Live Qloo evidence" / "Recorded Qloo evidence" / "SYNTHETIC evidence (test world, not Qloo)" | From the report |

## 10. Test results

All runs are offline, with no provider calls (Node 22.23.2).

| Suite | Result | Scope |
| --- | --- | --- |
| `pnpm lint`, `pnpm typecheck`, `pnpm build` | pass | whole monorepo (after rebase onto `c9293c3`) |
| `pnpm check:deployment-config` | `OFFLINE_DEPLOYMENT_CONFIG_PASS` | remote platform state not verified (by design) |
| Backend `vitest` | **873 / 873** | includes the new suites below |
| Frontend unit (`node --test`) | **75 / 75** | includes `comparative.test.ts` |
| Browser (`playwright`, synthetic job API) | **54 / 54** | includes the 3 new `comparative-research.spec.ts` tests |
| `pnpm check:secrets` | pass | 596 repo files and 19 browser bundle files; no leakage |
| `pnpm eval:methodology` | 19 / 19 checks | SYNTHETIC fixtures |
| `pnpm eval:elasticity` | 27 / 27 | offline |
| `pnpm eval:agent` | 53 / 53 scenarios | SYNTHETIC world |
| `pnpm eval:query` | all acceptance criteria PASS; 57 / 57 handoffs | ADVERSARIAL handoff 9/10 and category M 2/3, **identical on `origin/main`** (pre-existing) |

New tests, mapped to the sprint's mandatory scenarios:

| # | Scenario | Where |
| --- | --- | --- |
| 1 | Completed hypothesis → valid references → comparison | `comparative-journey.test.ts` (API, real routes), `comparative-research.spec.ts` (browser) |
| 2 | Insufficient / unverified references | journey test 2; `comparative-elasticity.test.ts` tests 2b, 8 and 9 (real recorded Loewe evidence) |
| 3 | Incompatible ranking types | journey test 2 (API 422); browser journey |
| 4 | Cross-domain without numerical comparison | `comparative-outcome-9i.test.ts` (Espresso brand panel kept out; `rankable: false`) |
| 5 | Brand and scan ownership | journey test 5 (wrong token, other scan, other job → 404); `BRAND_MISMATCH` |
| 6 | Duplicate concept and exemplar | `comparative-elasticity.test.ts` test 4 |
| 7 | Wrong provenance | forged reference ids (422), smuggled fields (400), `REFERENCE_UNGROUNDED`, unsourced target |
| 8 | Paused paid admission | journey test 8 (503, no run); browser paused test (no enabled start) |
| 9 | Budget exhaustion and uncertain outcomes | journey test 9 (idempotent start, `budget_exhausted` 429); in-run budget and non-retryable rank error (outcome tests) |
| 10 | Failed or expired job | journey test 10 (failed, expired, unknown → no report) |
| 11 | Classification and panel evidence | journey test 1 (report equals the result; single type and panel); integrity tampering test |
| 12 | Recorded / live / synthetic labels | outcome test 12/13; demo checksum test; UI badges |
| 13 | Source-grounded explanation | interpretation only when validated; exemplars cited; recorded relationships cite `mcp-` ids |
| 14 | Summary and export fidelity | `comparative.test.ts`; browser test checks the downloaded HTML |

The browser stubs are not hand-written. They were recorded from the real backend routes over the synthetic world (`backend/scripts/synthetic/build-comparative-e2e.ts`).

**Regression on main repaired in tests only.**

- PR #33 made paid admission opt-in (`CE_ACCEPT_INVESTIGATIONS === "1"`). That left 10 existing backend tests on `origin/main` failing (850/860 there). They exercise behaviour behind an open admission: agent API, job API, query API, and the 5B3 and 7B public guards.
- They now opt in explicitly, per file or block, and restore the env afterwards.
- No production code changed for this, and #33's own fail-closed tests still pass.
- This is a separate commit, so the owner can review it on its own.

Two other failures predate this sprint and are **identical on `origin/main`**. They are not fixed here:

- `pnpm eval:live`: 19/21 cases. Both `evals/fixtures/live/loewe-baseline-canary-*.live.json` fail the live-packet schema.
- `qloo-value-benchmark.test.ts` needs gitignored `backend/feasibility-output/` artifacts. A fresh clone fails 2 tests until they are copied in; the counts above include them.

GitHub Actions on `main` has failed in about 3 s on every recent merge: jobs do not start (billing, per AGENTS.md). CI is therefore not an effective gate, and the results above are local.

## 11. Telemetry and costs

- No live Qloo or Anthropic call was made in this sprint. Measured provider cost: **$0**.
- The comparative job reuses the existing job, spend and span telemetry (`job_*`, `budget_reserved`/`reconciled`, per-run spans).
- The authorization panel shows the reserve the server will hold: $0.40 in dev, with a $0.50 floor on public deployments.

## 12. Open risks and limitations

- **Live comparative validation is not run.** No authentic comparative ranking exists for any brand yet.
- **Jobs and plans are in process.** Comparative plans, sibling lookup and idempotency keys vanish on restart (as with all agent jobs). Sibling discovery covers only investigations started in the same process, from the same scan.
- **Concept re-resolution.** The comparison re-resolves territories by label. A drifted target concept is caught as `INTEGRITY_FAILED`; a drifted reference concept is reported as a limitation. The runtime cannot yet be pinned to the investigated concept ids.
- **Narrow type evidence.** Tag-profile type evidence proves that at least one entity of that type carries the tag. The runtime must still find exemplars, and may then exclude the reference: an honest PARTIAL.
- **Gaps in the recorded data.** Recorded results do not keep exemplar tag profiles, so profile-tag references only appear for live, in-process parents.
- **Brief continuity.** The comparison section of the brief uses the latest report from the open panel; navigating away discards it (in-memory, like findings).
- **Older 9H tests used real brand names.** Some 9H tests named "Loewe" with placeholder ids. The rewritten tests use SYNTHETIC names, but the remaining 9H tests 15 and 18 still say "Loewe".
- **iCloud.** The repository on `~/Desktop` is iCloud-synced and had been fully evicted (disk full). Work continued in `~/dev/cultural-elasticity`.

## 13. Rollback

- No migration, no environment flag and no deployment change. Revert the sprint commit (`git revert <sha>`) or close the PR unmerged.
- The added routes are inert unless `CE_BASELINE_ENABLED=1` with a database, and unless admissions allow a paid start.

## 14. PR and merge status

- PR **#35** (`sprint/9i-cross-domain-cultural-intelligence` → `main`): **open, not merged.**
- Three commits: the feature; a test-only repair of the #33 regression; these docs.
- Merging needs owner review: Railway builds from `main`, and GitHub Actions jobs do not start.

## 15. Sprint 9J production-readiness blockers

1. Owner authorization and execution of the bounded live run ([LIVE_VALIDATION_REQUEST.md](LIVE_VALIDATION_REQUEST.md)), followed by a recorded-live comparative demo rebuilt from it.
2. Durability of agent jobs, comparative plans and job-to-scan ownership. These are in memory today; a restart loses them.
3. A public spend budget and admission decision for comparisons. A comparison holds a full reservation, while single directions hold a smaller one.
4. Pinning the comparative run to the investigated concept ids, to avoid re-resolution drift.
5. Vercel protection gate and Railway single-replica constraints (unchanged from 8F), plus `smoke:remote` with admissions paused. Railway builds from `main`, so merging this PR changes the running backend: the added routes stay inert while `CE_ACCEPT_INVESTIGATIONS` is not `1`.
6. A CI that actually runs (GitHub Actions billing), and fixes for the pre-existing `eval:live` schema failures and the benchmark artifact dependency.
