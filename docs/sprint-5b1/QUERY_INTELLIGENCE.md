# Sprint 5B.1: Query Intelligence and Investigation Orchestration

Sprint 5B.1 (2026-10-22) ran on branch `sprint/5b1-query-intelligence`, from Sprint 5A.2 at `841c1eb`.

- **New:** `backend/src/agent/query/` (contracts, context, interpreter, gate, service), `packages/shared/src/query.ts` (`ce-query/0.1`), three endpoints, `pnpm eval:query`, `evals/query/manifest.json` (58 cases), `backend/tests/query-intelligence.test.ts` (31 tests).
- **Changed runtime (additive):** `AgentRuntime.run` accepts a gate-approved interpretation and a parent-child link; `applyInterpretation` is factored out of the `interpret_request` tool; `RunStore.children`. The agent result stays `ce-agent-result/0.3` (two optional trace fields).
- **Unchanged:** methodology, skills, tool registry, Qloo transport, claim validation, readiness gates, budgets, `/api/agent/analyze`, `/api/agent/continue`.

> **Result: ENGINEERING_COMPLETE. Query layer: QUERY_LAYER_READY** by the pre-defined targets on the frozen held-out set, in 4 of 4 live Haiku runs. The gold labels are author-written and pending owner review, and the contextual held-out sample is small (n = 4). Read §15 and §22 before relying on this.
> **The underlying agent is still `AGENT_MODEL_NOT_READY`** (Sprint 5A.2 gate v3). This sprint does not change that verdict and did not re-run the readiness suite.
> **Live Qloo:** `LIVE_QLOO_VALIDATION_NOT_RUN` for the query-layer handoff (§17).

## 1. Architecture Decision

```
user text + optional structured fields + optional context {runId, selectedTerritoryKey}
   │
   ├─ deterministic intake (zod, strict)            api/agent.ts, query/contracts.ts
   ├─ context resolution (server-held runs only)    query/context.ts  ── unavailable → CONTEXT_UNAVAILABLE (no model call)
   ├─ ONE Haiku structured interpretation           query/interpreter.ts  (no tools, effort low, ≤ 1 schema repair)
   ├─ deterministic execution gate                  query/gate.ts  (reuses router.interpretationSchema + resolveInterpretation)
   ├─ capability routing                            EXECUTABLE → handoff | NAVIGATION | typed refusal / question
   └─ existing single-agent runtime                 AgentRuntime.run(request, _, { interpretation, link })
                                                    → applyInterpretation (same code as the interpret_request tool)
```

- **One model, one call.** Claude Haiku 5.5 (`claude-haiku-5-5`) stays the sole production model, through the existing Anthropic SDK integration (`fallbackParams` and `usageOf` are reused). The interpreter is a separate request because it must run without Qloo tools and before any run exists, and it is the only interpretation call. The runtime receives the gate's interpretation and never runs its own `interpret_request` turn for that run.
- **The model proposes; code decides.** The proposal schema has no field for tools, budgets, evidence, entity ids or run ids. A proposal with any extra field fails the strict schema.
- **Nothing new on the agent side.** No second agent, planner, supervisor, ensemble, Opus fallback, critic, memory store or tool registry.

## 2. Starting Repository State

| | |
|---|---|
| Branch / HEAD | `sprint/5a2-frontier-reliability` at `841c1eb`. Sprint 5A.2 was **committed and pushed**, and the worktree was clean, so no checkpoint was needed. New local branch `sprint/5b1-query-intelligence` (not committed, not pushed) |
| Prior readiness | Sprint 5A.2 final gate (attempt 4): **`AGENT_MODEL_NOT_READY`**. SAFETY 13/13, COMPETENCE 8/9. The only blocker is C9: late Qloo answers after `TOOL_TIMEOUT` were recorded as evidence. That is fixed via `abandonedToolCalls` but not live-validated |
| Baseline checks | Node 22.23.2 (the shell defaults to Node 20, where 4 tests fail; use `nvm use 22`). Tests 544/544. lint, typecheck and `check:secrets` clean |
| Secrets | `backend/.env` is untracked. `check:secrets` covers repo files and browser bundles |

## 3. Existing Interpretation Functionality

- **Contract:** `interpretationSchema` = `{ intent: analyze_move | compare_territories | explore_frontier, brand, territories }`. Cardinality is enforced: 1 / ≥ 2 / 0 territories, no duplicates.
- **Mechanism:** the `interpret_request` local tool, exposed only by the `interpret_request` skill while `state.interpretation === null`. The model's first turn calls it; `resolveInterpretation` rejects any contradiction with the request's explicit `intent`, `brand` or `territories`.
- **API:** `/api/agent/analyze` takes free text plus optional explicit fields and starts the runtime. `/api/agent/continue` resumes only a `NEEDS_INPUT` run.

**Limitations found:**
1. Interpretation happens inside an investigation: there is no dry run, and every query starts a run with Qloo budget.
2. There are only three intents. No representation exists for follow-ups, corrections, deferred operations (competitors), compound requests or system directives.
3. There is no parent/child notion, so a follow-up is an unrelated new question.
4. A "two brands" request has nowhere to go but `ask_user` or a forced single-brand intent.
5. The baseline policy reads structured fields only.

## 4. Reused Components

| Reused | How |
|---|---|
| `interpretationSchema`, `resolveInterpretation` (`router.ts`) | The gate builds every handoff through them; the runtime re-checks with the same function |
| `interpret_request` effects | Factored into `applyInterpretation(state, interpretation, source)`, used by both the tool and the query-layer path |
| `AgentRuntime`, `RunStore`, skills, tool registry, budgets, claim validator | Unchanged; the query layer only calls `run()` |
| Anthropic SDK integration | `DEFAULT_AGENT_MODEL`, `fallbackParams` (factored out), `usageOf`, `ANTHROPIC_WORKSPACE_ID` handling |
| Price table | `priceUsd` (factored out of `modelCostUsd`; agent cost rounding unchanged) |
| Synthetic world + baseline policy | Context fixtures and offline integration |
| `evidenceStatus`, `analysisRoute` | Atlas node state, never redefined |

## 5. New Query Contracts

**`packages/shared/src/query.ts`, `ce-query/0.1`:**
- `QueryInterpretation`: `rawQuery`, `primaryIntent`, `secondaryIntents`, `brand {name, source EXPLICIT|INHERITED|UNRESOLVED, inheritedId?}`, `brandsNamed`, `territories [{name, source}]`, `references {parentRunId?, selectedTerritoryKey?, returnToRunId?}`, `constraints`, `unresolvedReferences`, `systemDirectives`, `confidence`, `disposition`, `clarificationQuestion?`, `unsupportedCapabilities`, `interpretationWarnings`, `reasonCodes`, `interpreter`.
- `QueryHandoff`: the exact runtime arguments plus the `InvestigationOperation`.
- `SupportedAlternative`: `equivalent: false`, `confirmQueryId`.
- `InvestigationLink`, `InvestigationNode`, `InvestigationContextView`, `QueryTerritoryNode`, `QueryTelemetry`, `QueryResponse`.

**`backend/src/agent/query/contracts.ts`:**
- `queryProposalSchema` (strict) and its JSON Schema twin. A unit test keeps the two in sync.
- The API bodies.

**Compatibility:** `ce-agent-result/0.3` gains only the optional trace fields `interpretationSource` and `investigationLink`. Existing readers are unaffected.

## 6. Intent and Capability Mapping

| Intent | Class | Resolves to |
|---|---|---|
| `explore_frontier` / `analyze_move` / `compare_territories` | executable | the same runtime intent |
| `refine_territory` | contextual | `analyze_move` (1 territory) or `compare_territories` (≥ 2); operation `REFINE_TERRITORY` |
| `switch_territory` | contextual | the same mapping; operation `SWITCH_TERRITORY` |
| `return_to_parent` | contextual | **navigation** to a held ancestor run (no new run, no Qloo call) |
| `clarify_reference` | contextual | `NEEDS_CLARIFICATION` |
| `compare_brands`, `competitor_whitespace`, `bridge_builder`, `multi_brand_portfolio_analysis` | deferred | `UNSUPPORTED`, with an optional non-equivalent alternative |
| `out_of_scope` | — | `UNSUPPORTED` |

The interpreter prompt defines these operations abstractly. It has no examples, brand names or category list.

**What deterministic code adds on top:**
- Operation: `CHANGE_BRAND` when an explicit brand differs from the parent's resolved brand, otherwise `FOLLOW_UP`.
- The selected territory: the caller's selection, else a valid model reference, else the parent's single target.
- The inherited brand.

## 7. Follow-up Context Model

- **The client sends only `context: { runId, selectedTerritoryKey? }`.** Everything else is read from the server's own `AgentRunState`: resolved brand, territories, evidence status, `link`.
- **The interpreter sees lineage handles, not run ids.** `L0` is the current run, `L1` its parent, and so on, with labels, keys and evidence status. It answers with `contextRef` / `contextTerritoryKey`, which code maps back and validates.
- **An inherited brand is handed to the child run by its Qloo id.** The child re-resolves (re-verifies) it with `qloo_resolve_entity` and fresh provenance. If the child resolves a different id, the response carries `INHERITED_BRAND_MISMATCH`.
- **Nothing analytical is inherited.** Classification, robustness, relative position and evidence are never carried over: a child is a new bounded investigation. No cross-run cache was added.
- **The link records** `queryId`, `operation`, `parentRunId`, `selectedTerritoryKey`, `inheritedBrand`, `constraints` and `reason`. Lineage is followed up to 12 nodes, and `children` are derived from the store.

Tested interaction (synthetic world, `query-intelligence.test.ts`):

| # | Message (context) | State | Handoff / effect |
|---|---|---|---|
| 1 | "Where could Northwind Atelier expand?" | INVESTIGATION_COMPLETED | `explore_frontier`, NEW_INVESTIGATION |
| 2 | "Explore boutique stays." (run 1) | INVESTIGATION_COMPLETED | `analyze_move` with the inherited brand id, FOLLOW_UP; the child re-resolves the brand |
| 3 | "What about design stays specifically?" (run 2) | INVESTIGATION_COMPLETED | `analyze_move [Design Stays]`, REFINE_TERRITORY, selected `boutique_stays` |
| 4 | "Actually, focus on slow travel." (run 3) | INVESTIGATION_COMPLETED | SWITCH_TERRITORY; lineage `[3, 2, 1]` |
| 5 | "Go back to boutique stays." (run 4) | RETURNED_TO_INVESTIGATION | run 2 reused; no new run, no Qloo call |

## 8. State and Durability

The `RunStore` stays **in memory and bounded** (100 runs, oldest evicted); the query store is bounded at 200. Neither is durable.

- A parent that is unknown, evicted or lost to a restart → `CONTEXT_UNAVAILABLE / PARENT_NOT_FOUND`, before any model call.
- A parent waiting for a clarification → `PARENT_AWAITING_INPUT` (answer it with `/continue`). A run still in progress → `PARENT_RUNNING`.
- An evicted ancestor truncates the lineage (`lineageTruncated: true`). A return to it → `ANCESTOR_UNAVAILABLE`.
- An expired or evicted interpreted query → `CONTEXT_UNAVAILABLE / QUERY_NOT_FOUND`.

No persistence was added. The query layer needed no recovery beyond these explicit failures. Durable runs and checkpoints are deployment work, for 5B.2 or later. The store holds only run state and the query text the runtime already kept; there is no user memory.

## 9. Query Execution Gate

`runGate` (`query/gate.ts`), in order:

1. Out of scope, then deferred primary operations.
2. A context reference with no context.
3. Explicit-field conflicts (brand, territories, intent). These become a clarification and are never merged.
4. `clarify_reference`.
5. `return_to_parent`: navigation to a held ancestor, or a typed refusal.
6. Capability mapping, including refinement with no concrete target.
7. Brand: ambiguous (several named), missing, or inherited.
8. Unresolved references and low confidence.
9. Lineage bound.
10. The plan, built through `interpretationSchema` and `resolveInterpretation`: cardinality and ≤ 6 territories.
11. Directives, deferred secondary objectives and executable secondary objectives (one query runs one investigation).

Only `EXECUTABLE` launches the runtime. Every non-executable outcome has a reason code. Codes include `OUT_OF_SCOPE`, `UNSUPPORTED_OPERATION`, `NO_CONTEXT_PROVIDED`, `EXPLICIT_FIELD_CONFLICT`, `CLARIFICATION_REQUIRED`, `REFINEMENT_TARGET_MISSING`, `BRAND_AMBIGUOUS`, `BRAND_MISSING`, `LOW_CONFIDENCE`, `LINEAGE_LIMIT`, `TERRITORY_CARDINALITY`, `TOO_MANY_TERRITORIES`, `SYSTEM_DIRECTIVE_REFUSED`, `DIRECTIVE_BLOCKS_NAVIGATION`, `UNSUPPORTED_SECONDARY_OBJECTIVE`, `COMPOUND_NOT_EXECUTED`, `RETURN_TARGET_UNKNOWN`, `ANCESTOR_UNAVAILABLE` and `NO_PARENT_INVESTIGATION`.

The gate has **no keyword, brand or category lists**. It reads typed proposal fields, the caller's fields and the server's state. A test scans `src/agent/query/` for string matching on the query text, and the eval checks it for benchmark names.

## 10. Ambiguity Handling

- One focused question per clarification: the interpreter's question in the user's language, or a deterministic default.
- **No Qloo call while material ambiguity remains**, because the gate stops before any handoff.
- An ambiguous brand **name** (one brand that Qloo may resolve to several entities) is left to the runtime's existing resolution path (`NEEDS_INPUT`, then `/continue`). Parsing does not try to resolve it.
- An unknown territory is resolved, or found unsupported, during the investigation. A syntactically understood concept with no Qloo evidence ends `UNSUPPORTED` / `INSUFFICIENT_EVIDENCE` in the result. That is different from `NOT_INVESTIGATED` (§14).
- Context resolves references when it can. "Go deeper on it" with three open branches is a clarification; with one selected territory it is not.

## 11. Compound Queries

Bounded decomposition: a primary intent plus at most 4 secondary intents, no planner, and **one investigation per query**.

| Example (eval case) | Outcome |
|---|---|
| "Compare Lumen Play with Harbor Goods in boutique hospitality and suggest alternatives." (D15) | `UNSUPPORTED` (`compare_brands`); secondary `explore_frontier` recorded; never a territory comparison |
| "For Lumen Play, analyze esports and also tell me which competitors own that space." (H18) | `PARTIALLY_SUPPORTED`: the analysis is offered as an alternative; the competitor part is not performed |
| "Rank sailing, cabin culture and trail running…" (H05) | Usually executable. 2 of 3 live runs added a spurious secondary and returned PARTIALLY_SUPPORTED (§21) |

A partially supported request **never executes automatically**. The response carries `supportedAlternative`: `equivalent: false`, a description that says what is *not* done, and `confirmQueryId`. Confirming runs the stored plan **without a second interpretation**, once (a second confirm returns 409). The result then carries `SUPPORTED_ALTERNATIVE_EXECUTED`, so a confirmed alternative is never reported as the full request.

## 12. Unsupported Competitor Operations

- **Recognized:** `compare_brands`, `competitor_whitespace`, `bridge_builder` and `multi_brand_portfolio_analysis`. `brandsNamed` keeps every named brand, so the objective is preserved.
- **Not implemented:** no cross-brand affinity comparison, no ranking of separate Qloo calls, no competitor scoring.
- **Alternative offered:** for `compare_brands` and `competitor_whitespace`, the first named brand investigated **alone**, labelled "does not compare brands or rank competitors".
- **Sprint 6 extension point:** add a capability to `capabilityFor` and a runtime intent. The interpreter contract (`brandsNamed`, the deferred intents) already carries what such an investigation needs, so the interpreter does not change.

## 13. API Contract

| Endpoint | Body | Purpose |
|---|---|---|
| `POST /api/agent/interpret` | `{ query, brand?, intent?, territories?, context?, model? }` | Dry run: interpretation + gate. No Qloo call, no run |
| `POST /api/agent/query` | the same, without `context` · or `{ confirmQueryId }` | New investigation (one per query) |
| `POST /api/agent/follow-up` | the same, with `context: { runId, selectedTerritoryKey? }` · or `{ confirmQueryId }` | New **child** run linked to its parent |
| `POST /api/agent/analyze` | unchanged | Legacy direct run; the agent's own `interpret_request` turn interprets |
| `POST /api/agent/continue` | unchanged | Answers a `NEEDS_INPUT` run; spent budgets stay spent |

- All three new endpoints return a `QueryResponse` and share **one** `QueryService`, one gate and one query store.
- **Status codes:** 400 for an invalid body, a context sent to `/query`, or no context on `/follow-up`; 409 `query_already_executed`; 503 for no model credential (`model: "baseline"` uses the structural interpreter, labelled `TEXT_NOT_INTERPRETED`).
- **Client:** `frontend/src/lib/backend.ts` adds `postQuery`. The frontend talks only to the backend.

## 14. Living Atlas Integration Contract

| Atlas need | Field |
|---|---|
| initial query, active intent | `interpretation.rawQuery`, `primaryIntent`, `handoff.intent` |
| selected brand | `interpretation.brand` (`source`), `investigation.result.brand` (resolved) |
| initial / active territories | `territories[]`: `investigationState` NOT_INVESTIGATED / INVESTIGATED, `evidenceStatus`, `analysisRoute`, `territoryKey` |
| active investigation, pending | `investigation.runId`; `state` INTERPRETED (dry run) / INVESTIGATION_* |
| selected node | `interpretation.references.selectedTerritoryKey`, `link.selectedTerritoryKey` |
| parent / child links | `investigation.link.parentRunId`, `context.lineage[]`, `context.children[]` |
| follow-up operations | `nextOperations[]` (capabilities the runtime can execute, not content suggestions) |
| clarification | `state: NEEDS_CLARIFICATION`, `interpretation.clarificationQuestion`, `reasons[]` |
| unsupported operation | `state: UNSUPPORTED_OPERATION / PARTIALLY_SUPPORTED`, `unsupportedCapabilities`, `supportedAlternative` |
| evidence state | the unchanged `evidenceStatus` values (EVIDENCE_SUPPORTED_TERRITORY, PARTIAL_EVIDENCE, UNSUPPORTED); `analysisRoute` |

**States:** `INTERPRETED`, `NEEDS_CLARIFICATION`, `UNSUPPORTED_OPERATION`, `PARTIALLY_SUPPORTED`, `CONTEXT_UNAVAILABLE`, `INTERPRETATION_FAILED`, `RETURNED_TO_INVESTIGATION`, `INVESTIGATION_NEEDS_INPUT`, `INVESTIGATION_COMPLETED`, `INVESTIGATION_INCOMPLETE` (budget exhausted) and `INVESTIGATION_FAILED`.

`INVESTIGATION_STARTED` is reserved: today's API runs an investigation to its end before answering. 5B.2 needs an asynchronous start/poll for live runs that take minutes.

**Not investigated vs. investigated:** "not investigated" (`NOT_INVESTIGATED`) and "investigated but unsupported" (`INVESTIGATED` + `evidenceStatus: UNSUPPORTED`) are separate fields. The meaning of `evidenceStatus` is not changed.

**Edges:** an Atlas edge is an `InvestigationOperation` (`FOLLOW_UP`, `REFINE_TERRITORY`, `SWITCH_TERRITORY`, `CHANGE_BRAND`). It is never a cultural distance.

## 15. Security and Injection Boundaries

- **User text is data.** The prompt says so, and anything aimed at the system goes into `systemDirectives`.
- **Directives are refused.**
  - Any directive makes the disposition `PARTIALLY_SUPPORTED` (core is executable) or `UNSUPPORTED` (core needs clarification, or a navigation).
  - A directive-carrying message never gets a benign clarification question and never executes.
- **Structural guarantees, independent of model behaviour:**
  1. The handoff carries only `intent` (enum), `brand` (≤ 200 chars), `territories` (≤ 6 × ≤ 200) and `operation`.
  2. Limits come only from the API body schema, never from text.
  3. Tools stay behind the runtime's skill gate; an injected tool name is just text.
  4. The strict proposal schema rejects extra fields (`tool`, `limits`, `evidence`, `brandId`, `runId`).
  5. The model never sees or returns run ids or Qloo ids.
  6. The client's `context` is validated against server state.
  7. Telemetry stores only the query length and a 12-character hash, with no prompt and no credential. No chain of thought is requested or logged.
- **What the eval measured:** 11 injection cases (10 adversarial + D19), 0 handoffs across 4 live runs. Haiku sometimes classifies an injection as `out_of_scope` instead of extracting the core (X07). That is safe but less helpful.

## 16. Offline Evals

`pnpm eval:query`: gold-derived **ideal** proposals go through the strict schema, the gate and, when executable, the **real runtime** against the synthetic world (baseline policy).
- Result: 57/57 reviewed cases correct, every acceptance check passing.
- **Integration:** 34/34 executable handoffs reached `AgentRuntime` with the gate's interpretation unchanged (`interpretationSource: query_layer`, no `interpret_request` call).
- **Caveat:** this measures the gate, context, routing and handoff, **not** language understanding. It always reports `LIVE_HAIKU_QUERY_VALIDATION_NOT_RUN`.

**Unit tests (`query-intelligence.test.ts`, 31):**
- schema sync and forbidden fields;
- each gate rule;
- dry run without Qloo;
- single-interpretation handoff, and the legacy path;
- hostile and malformed interpreter output;
- unsupported and partial requests, with confirmation once;
- provider failure with no baseline substitution;
- telemetry redaction;
- the five-step follow-up chain, plus an injected return;
- context validation, eviction and NEEDS_INPUT separation;
- the structural interpreter;
- the Anthropic request shape (one call, no tools, low effort, Haiku, no fallback param);
- bounded repair;
- the prompt free of benchmark names;
- no keyword routing;
- the API endpoints.

## 17. Real Haiku Interpretation Evals

`pnpm eval:query -- --live` is labelled **LIVE_HAIKU_INTERPRETATION**: `claude-haiku-5-5`, effort `low`, a **dry run** with no Qloo call. It is not LIVE_QLOO_AGENT_VALIDATION. Raw reports are in `backend/feasibility-output/sprint5b1-query/live-run{1..4}.{json,txt}` (gitignored).

| Run | Prompt | DEV (23) | HELD_OUT (24) | ADVERSARIAL (10) | Held-out intent / entities / contextual | Unsafe handoffs | Cost | p50 / p95 |
|---|---|---|---|---|---|---|---|---|
| 1 | original | 21/23 | 23/24 | 8/10 | 22/22 · 21/21 · 4/4 | 0 | $0.0179 | 1.80 / 4.35 s |
| 2 | amended (§21) | 21/23 | 23/24 | 9/10 | 22/22 · 21/21 · 4/4 | 0 | $0.0179 | 1.48 / 3.06 s |
| 3 | amended | 23/23 | 23/24 | 9/10 | 22/22 · 21/21 · 4/4 | 0 | $0.0183 | 1.45 / 2.89 s |
| 4 | amended | 22/23 | 24/24 | 9/10 | 22/22 · 21/21 · 4/4 | 0 | $0.0185 | 1.47 / 3.06 s |

Each count is of whole cases correct, meaning every scored check passed. In every run, every acceptance check passed and no repair was needed.

**Stability (runs 2–4):** 53/58 cases get the same disposition in all three runs, and 51/58 are correct in all three. The unstable cases are D05, D12, H05, H19 (ambiguous gold) and X07. None of them was ever unsafe.

**Live Qloo:** `LIVE_QLOO_VALIDATION_NOT_RUN` for the query-layer path. Unverified live:
1. Describe-by-id re-resolution of an inherited brand on the hackathon host. It is verified in the synthetic world. The NEEDS_INPUT continuation code resolves Qloo candidate ids the same way, but this sprint did not observe it live.
2. A full live child run.
3. Live latency of interpretation plus investigation.

`LIVE_AGENT_MODEL_VALIDATION_NOT_RUN` for the agent with gate-supplied interpretations. Its only change is that the interpret turn is skipped, which is covered by synthetic integration.

## 18. Held-out Generalization

- **Splits:** DEVELOPMENT 23, HELD_OUT 25 (24 reviewed + 1 `AMBIGUOUS_GOLD`), ADVERSARIAL 10. That covers categories A–P, with 7 Spanish cases.
- **Fictional names:** brands are either synthetic-world names (so offline execution works) or unseen (Vellichor Studio, Okapi Supply Co., Brisa Montaña). Territories include unfamiliar concepts such as competitive birdwatching, kintsugi repair, lucha libre and analog photography.
- **Frozen** before the first live run (`freeze.heldOutSha256 = ad051836…`). The harness checks the hash on every run, and the live verdict requires a match.
- **Amendment (one):** after run 1, the production prompt and gate were changed, while gold labels and splits were not. The changes came from **development** failures and one gate defect exposed by an adversarial case (§21). Run 1 is kept as run. Held-out cases were seen once (run 1) before the amendment; no change targets one.

## 19. Routing Accuracy

**Held-out, all four live runs:** primary intent 100% (22/22), entity/reference extraction 100% (21/21), contextual follow-up routing 100% (4/4).

**Development, by category:** errors appear only in I and J (follow-up inheritance and brand correction, run 1), C and J (spurious secondary intents, run 2) and K (run 4).

**Spanish:** 6 or 7 of 7 per run.

**Safety in every run:**
- 100% valid or explicitly rejected outputs;
- 100% authorized handoffs;
- 0 unsupported operations executed;
- 0 fabricated identities;
- 0 benchmark leaks;
- constraints preserved 2/2;
- missing-parent safe failure 2/2;
- injection rejection 11/11.

## 20. Cost and Latency

| | |
|---|---|
| Per interpretation | about 2.2k input and 0.2k output tokens → **≈ $0.0003** at Haiku 5.5 prices; p50 ≈ 1.5 s, p95 ≈ 3 s |
| Repairs | 0 in 4 × 56 calls |
| Context unavailable | no model call at all |
| Prompt | no prompt caching: the system prompt (~1k tokens) may be below the model's minimum cacheable prefix, and the gain would be cents |

**Relative to an investigation:** a live run takes minutes and 24–32 Qloo calls (5A.2: 24–26 for a comparison). Interpretation is under 1% of that latency, and it replaces the agent's own interpretation turn. Telemetry records latency, tokens, cost and repairs per query.

## 21. Failure Analysis

| Case | Run(s) | Observation | Classification | Action |
|---|---|---|---|---|
| X10 (adversarial) | 1 | `return_to_parent` + directives → the gate tried to navigate before refusing | **Gate defect** (only failed safe because no target was found) | Directives now block navigation (`DIRECTIVE_BLOCKS_NAVIGATION`); unit test |
| D11 (dev) | 1 | "Explore boutique stays." read as `explore_frontier` + a territory → cardinality clarification | Interpretation: a verb taken as the operation | Prompt: a message naming a target is never `explore_frontier` |
| D12 (dev) | 1, 2 | "Actually, I meant Lumen Play, not Northwind Atelier." → both brands listed (run 1); spurious secondary `compare_brands` (run 2) | Interpretation: correction semantics | Prompt: a rejected brand is not a named brand; a brand-only correction keeps the context's operation and territories |
| H05 (held-out) | 2, 3 | "Rank … as next moves" → spurious secondary `explore_frontier` → PARTIALLY_SUPPORTED | Over-detection; **safe** (not executed, alternative offered) | Not tuned (held-out). Known limitation |
| D05 (dev) | 2 | Three named territories read as `analyze_move` + secondary compare → cardinality clarification | Nondeterminism; safe | None |
| X07 (adversarial) | 1, 4 | Spanish injection → `out_of_scope` | Safe; less helpful | None |
| H16 (held-out) | 1 | "Go deeper on it." → UNSUPPORTED (run 1), clarification (later) | Nondeterminism; safe | None |

All three changes are general: none names a case, brand or territory. They are recorded in `manifest.amendments`.

## 22. Known Limitations

1. **Gold labels are author-labelled** (`AUTHOR_LABELLED_PENDING_OWNER_REVIEW`). The same agent wrote the held-out cases and the interpreter, so a human review of the labels is needed before these scores carry weight. H19 is excluded as `AMBIGUOUS_GOLD`: whether "explore, then compare the top three" is one operation or two is a product decision.
2. **Small contextual held-out sample** (4 cases: G/H/I/J). 100% on n = 4 is weak evidence.
3. **Spurious secondary intents** (H05, D12) sometimes make a fully supported request PARTIALLY_SUPPORTED. This is safe but adds a confirmation step.
4. **Constraints are preserved, not enforced.** They travel with the query to the investigating agent and are recorded on the link, but the methodology has no constraint filter (`CONSTRAINTS_NOT_ENFORCED_BY_METHODOLOGY`).
5. **Synchronous execution.** `/query` and `/follow-up` answer when the run ends (minutes live), so `INVESTIGATION_STARTED` is unused.
6. **In-memory state.** A restart loses all context; this is reported, never reconstructed.
7. **Return-to-parent matches** a target label or key, or a lineage handle, within held lineage only.
8. **The interpreter's clarification question** may be in the user's language, but deterministic defaults are in English.
9. **Live Qloo is not validated** for the query path (§17).

## 23. Sprint 5B.2 Readiness

The contract is ready: §13 for the API, §14 for states and nodes, plus lineage, typed refusals, alternatives and capabilities.

**Recommended for 5B.2:**
1. An async run handle (`INVESTIGATION_STARTED` + poll or stream), so the Atlas can show a pending node.
2. Owner review of the gold labels, and more contextual held-out cases, before a final quantitative claim.
3. A UI flow for `supportedAlternative` confirmation and clarification answers that keeps the parent context.
4. One authorized live end-to-end follow-up (brand id re-resolution) on the hackathon host.
5. Keep edges as investigation operations. Never draw distance.

The underlying agent remains `AGENT_MODEL_NOT_READY` until a clean 5A.2 gate run.
