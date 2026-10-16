# Agentic Investigation Runtime

Sprint 3 (2026-10-16). Code: `backend/src/agent/`. Contract: `packages/shared/src/agent.ts`. Entry points: `POST /api/agent/analyze`, `POST /api/agent/continue`, `pnpm agent:run`, `/dev/agent`, `pnpm eval:agent`.

**Validation status, stated up front**

| What | Status |
| --- | --- |
| Runtime, tools, validators, routing, methodology integration | Tested: 413 backend tests, `pnpm eval:agent` 28/28 (SYNTHETIC world) |
| Qloo tool boundary through `qloo mcp` | **Live-validated** on the hackathon API. See [Live runs](#live-runs). |
| The agent **model** (Claude) | **`LIVE_AGENT_MODEL_VALIDATION_NOT_RUN`**: no `ANTHROPIC_API_KEY` was available. The provider is implemented and tested against a mocked client only. |
| Live runs | Driven by the deterministic **baseline reference policy**, not by a language model, and labelled so in every output |

## Architecture Decision

**Single agent + typed tools + deterministic engine.** One model proposes structured actions. A typed tool registry executes them against Qloo (read-only) and against local deterministic code. The Sprint 1 Evidence Core and the Sprint 2 Methodology compute every number. There are no sub-agents, no queues and no persistence: runs live in memory (a bounded `RunStore`) so `NEEDS_INPUT` runs can continue.

```
user goal ─→ deterministic intake (zod AgentRequest)
          ─→ loop (bounded):
               evidence sufficiency (deterministic) ── stop? ──→ finalize
               model.decide(AgentDecisionContext built from state)
               ─→ validate each decision ─→ tool executor / analyze / ask_user / finish
               ─→ state updated by code ─→ trace
          ─→ finalize: deterministic results ─→ model synthesis ─→ claim validator ─→ AgentAnalysisResult
```

| Module | Owns |
| --- | --- |
| `contracts.ts` | request, limits, interpretation, decision and synthesis schemas |
| `state.ts` | run state, status machine, evidence records |
| `router.ts` | interpretation consistency, comparison groups, route selection |
| `planner.ts` | the investigation checklist the model sees, and plan revisions |
| `tool-registry.ts`, `tool-executor.ts` | typed tools, permissions, validation, timeouts |
| `tool-provider.ts`, `qloo-gateway.ts` | Qloo status policy, budget, cache, provenance, evidence recording |
| `representation-planner.ts`, `candidate-discovery.ts` | representation validation and strategy, exemplar candidates, deduplication, frontier concepts |
| `analysis-runner.ts` | evidence plan, rank panels, methodology invocation, partial/descriptive analysis |
| `evidence-sufficiency.ts` | whether another iteration is allowed |
| `finalizer.ts`, `claim-validator.ts` | results, synthesis, claim validation, metrics |
| `model/` | `AgentModel` interface; `AnthropicAgentModel` (live), `ScriptedAgentModel` (tests), `BaselinePolicyModel` (reference policy) |

## Why This Is an Agent

The model decides what to investigate and how. It interprets the goal, chooses which concepts to search for, chooses among Qloo tags, proposes territory hypotheses and references, picks exemplars, and decides when to analyze, ask or finish. None of this is a fixed sequence. The same runtime runs a single move, a comparison or an open frontier search. Within one run, territories with different Qloo structure follow different strategies and routes (see [Multiple Analysis Routes](#multiple-analysis-routes)). The model reacts to tool results, including rejections, empty pools, ambiguities and duplicates, and revises its plan. The trace records each revision.

## Why This Is Not an LLM Wrapper

- **Control flow is structured.** Every decision is a validated object (`call_tool`, `analyze`, `ask_user`, `finish`). Prose is never parsed into actions. A turn without a valid action is an invalid turn, and two in a row fail the run.
- **Evidence comes only from tools.** The model cannot cite an id, tag, affinity or rank unless a Qloo response in this run returned it. Validators refuse unobserved ids and tags.
- **The engine owns the answer.** Routes, positions, robustness, coherence, evidence quality and classes come from deterministic code. The model's only free text is the synthesis. A claim validator checks it, and a deterministic template replaces it on any violation.
- **Autonomy is bounded and enforced by code** (iterations, Qloo calls, attempts, territories, exemplars, actions per turn, retries, invalid turns, timeouts).

## Agent Responsibilities

Interpretation of the goal; investigation planning; tool choice; candidate discovery (hypotheses); representation strategy (which concept, which entity type, which exemplars and why); ambiguity handling (ask, or resolve by evidence); deciding whether more evidence is useful (within what sufficiency allows); synthesis of the deterministic results.

## Deterministic Responsibilities

Schemas and intake; tool permissions and argument validation; entity and type validation; comparison scope (one rank call per panel, ≥ 3 territories of one entity type); panel construction; every calculation (Sprint 2 methodology `elasticity-v0.1`, unchanged); robustness; operational-tag filtering; evidence quality (Sprint 1 core); route selection; evidence sufficiency; budgets; provenance; claim validation; status transitions.

## Supported Intents

| Intent | Known | Unknown | Notes |
| --- | --- | --- | --- |
| `analyze_move` | brand, one target | – | A relative position needs a comparison set, so the agent may add **reference** territories. Without ≥ 3 represented territories of one type, the target is analyzed partially. |
| `compare_territories` | brand, ≥ 2 territories | – | Rankable territories of one entity type form one comparison set; others are analyzed partially. |
| `explore_frontier` | brand | territories | Hypotheses come from model reasoning plus Qloo evidence (concepts carried by Qloo-related entities but not by the brand). Every hypothesis must be anchored, represented and analyzed before it means anything. |

Explicit request fields (`intent`, `brand`, `territories`) win over the model's interpretation. A contradicting interpretation is refused, never merged. When no explicit Qloo budget is given, the interpreted intent sets the default budget.

## State Machine

`INTAKE → PLANNING → RESOLVING → INVESTIGATING ⇄ ANALYZING → COMPLETE`, with `NEEDS_INPUT` (resumable to `PLANNING`), `FAILED` and `BUDGET_EXHAUSTED` as exits. `state.ts` holds the allowed-transition table, and `transition()` throws on anything else. The working phase is derived from evidence (`derivePhase`), so the model cannot set it. Tools declare the phases in which they may run.

Run state: `runId`, `status`, `request`, `limits`, `interpretation`, `brand` (entity / ambiguity / not-found), `territories` (hypotheses with role, origin, concept, representation, attempts, rejections), observed `entities`, `tags`, `profiles`, `pools`, `related`, a Qloo call cache, `results`, `methodologyRuns`, `flags` (partial/degraded), `usage`, `pendingQuestion`, `clarifications`, `trace`.

## Tool Registry

Every tool has a zod input schema (exposed to the model as JSON Schema), a typed `ToolResult` output, a permission class, a timeout, an upper bound on Qloo calls, allowed phases and a precondition. Its trace entry carries the correlation ids of every Qloo call it made.

| Tool | Permission | Qloo op | Purpose |
| --- | --- | --- | --- |
| `interpret_request` | local | – | structured interpretation, validated against the request |
| `qloo_resolve_entity` | read_only | describe | resolve brand or other entity; ambiguity handling |
| `qloo_find_tags` | read_only | find_tags | candidate concepts for a territory |
| `qloo_get_entity_tags` | read_only | entity_tags | tag profile (fixed take 20) |
| `qloo_recommend` | read_only | recommend | brand-independent tag-member pool (exemplar candidates) or brand-conditioned list (evidence only) |
| `qloo_related_entities` | read_only | recommend | entities Qloo associates with one entity (frontier discovery) |
| `propose_territory` | local | – | reference or frontier hypothesis (`qloo_evidence` origin needs observed tags) |
| `anchor_territory` | local | – | anchor to an observed concept tag; one concept per territory |
| `validate_territory_representation` | local | – | exemplar proposal → deterministic validation |
| `drop_territory` | local | – | remove from scope with a taxonomy code (stays visible) |
| `assess_evidence_sufficiency` | local | – | the deterministic sufficiency verdict |

Internal deterministic tools, run by `analyze` and traced but never model-callable: `analyze_evidence`, `build_candidate_panel` (the only use of `rank`), `run_elasticity_methodology`, `assess_representation_robustness`.

Deliberately **not** exposed: raw `rank`, because comparison scope belongs to code and an agent-chosen rank would not be a panel; `compare_audiences`, which has no documented metric (Sprint 0B); `audience_demographics`, `trends` and `where_popular`, which no methodology input uses. No tool can write files, run shell commands, touch git, deploy, send messages or mutate anything. The executor refuses any permission class other than `read_only_external` and `local_computation`. A `side_effect` class exists only so that refusal can be tested.

Executor refusals: `UNKNOWN_TOOL`, `UNAUTHORIZED_TOOL`, `NEEDS_USER_INPUT`, `EVIDENCE_SUFFICIENT`, `WRONG_PHASE`, `INVALID_ARGUMENTS`, `PRECONDITION`, `BUDGET_EXHAUSTED`; then `TOOL_TIMEOUT` / `TOOL_ERROR` at run time.

## Qloo MCP Boundary

```
Agent → ToolRegistry → AgentToolProvider (QlooToolProvider) → QlooTransport
                                                             ├─ HarnessMcpTransport → `qloo mcp` (default, live)
                                                             ├─ HarnessExecTransport → `qloo exec` (AGENT_QLOO_TRANSPORT=exec)
                                                             └─ SyntheticWorldTransport (ScriptedToolProvider, tests/evals)
```

`HarnessMcpTransport` (`backend/src/qloo/mcp-transport.ts`) speaks the official canonical MCP server's newline-delimited JSON-RPC over stdio: it sends `initialize`, then `tools/call qloo_<operation>`, and reads the workflow envelope from `structuredContent`. That envelope is identical to the `qloo exec` envelope, so the existing `parseEnvelope` and live adapter apply unchanged. The agent never sees stdio. It sees typed tools, and the transport sits behind the existing `QlooTransport` interface. Live facts observed on 2026-10-16:

- **Correlation ids.** The server derives them from the JSON-RPC request id (`mcp-<id>`), so every request uses a fresh UUID. Provenance stays unique across server restarts.
- **Pool entity types.** Members of a tag-filtered `recommend` come back with type `urn:entity`, so the requested target type is authoritative.
- **Pool order.** A tag-only pool has a flat affinity (0.765) in id order, so pool order is never used. Selection uses Qloo popularity within the returned window and discloses the window.
- **Ambiguity.** Ambiguous names return `needs_input` with candidates (for example "Meridian" and "Le Creuset" both resolve to two brands each).
- **Host safety.** The child process receives the same pinned hackathon environment, and the same offline `qloo doctor` host gate runs before any credentialed call.

The status policy (AGENTS.md) is applied once, in `QlooToolProvider`:

- `needs_input` is returned as `needs_input`;
- `partial` and `degraded` are flagged;
- `error` is retried once, and only if Qloo marks it retryable, with the retry capped to the remaining budget;
- `QLOO_AUTH` is never retried.

Identical requests within a run are answered from a cache and do not count against the budget.

## Representation Planning

Qloo has no "territory" object. A territory is represented by a **concept tag** plus, where Qloo supports it, **exemplar entities** linked to that concept. `planRepresentation` picks the strategy from observed structure only:

| Observed structure | Strategy | Rankable |
| --- | --- | --- |
| no concept anchored | `UNSUPPORTED` | no |
| accepted place exemplars | `PLACE_PANEL` | with other place territories |
| accepted brand (etc.) exemplars, all from brand-independent tag pools | `TAG_DERIVED_ENTITY_PANEL` | yes |
| accepted exemplars supported by their own profile tags | `ENTITY_PANEL` | yes |
| concept, no exemplars, some pool non-empty or none probed | `CONDITIONED_ENTITY_EVIDENCE` | no |
| concept, every probed pool empty | `DESCRIPTIVE_ONLY` | no |

**Validation** (`validateTerritoryRepresentation`) checks objective constraints only. Each rejection carries its taxonomy code:

- `ENTITY_UNRESOLVED`: never observed in a Qloo response in this run;
- `BRAND_AS_EXEMPLAR`: the brand itself;
- `DUPLICATE_EXEMPLAR`: proposed twice, or already represents another territory;
- `MIXED_ENTITY_TYPES`: wrong entity type;
- `BRAND_CONDITIONED_SELECTION`: seen only in a brand-conditioned list, so the brand would choose its own comparators;
- `EXEMPLAR_SEMANTIC_MISMATCH`: Qloo has not linked it to the concept, through tag-pool membership or its own profile tag;
- `NEAR_DUPLICATE_EXEMPLAR`: same name family, e.g. "X" and "X Collection";
- `EXEMPLAR_EVIDENCE_EMPTY`: its tag profile is empty.

Surviving exemplars are accepted. At most 3 exemplars and 3 attempts per territory are allowed.

## Dynamic Exemplar Discovery

```
territory → qloo_find_tags → concept tags → qloo_recommend (brand-independent pool, per type)
          → candidate pool → eligibility (exemplarCandidates) → model picks ≤ 3 with reasons
          → validator → (analysis) profiles fetched → diversity re-assessed
```

- **Selection quality** is not "first three results". Candidates are ordered by Qloo popularity within the pool window, and Qloo's pool order (id order for tag-only signals) is ignored. Name-family duplicates are refused, as are the brand itself and brand-conditioned picks. The reason recorded for each choice is reported per exemplar.
- **Diversity** is assessed from tag profiles. Two exemplars with a cultural-tag Jaccard ≥ 0.8 make diversity `low`. If any profile is unknown, diversity is `unknown`; it is never invented. The check is repeated after analysis has fetched the profiles.
- **Count.** Three exemplars are preferred. Two are the minimum for robustness. With one, analysis continues and robustness is `INSUFFICIENT`. With none, the territory falls back to concept-level evidence; substitutes are never manufactured.
- **Disclosure.** When a pool hit the 20-member window, the representation says so.

No production code contains an exemplar list; G2 enforces this.

## Multiple Analysis Routes

`selectAnalysisRoute` maps capability availability to a route:

| Route | When |
| --- | --- |
| `FULL_RELATIVE_ANALYSIS` | the territory is in a comparison set of ≥ 3 represented territories of one entity type, ranked in one rank call per panel (A/B/C by exemplar index, plus an optional A-repeat), and the Sprint 2 methodology ran |
| `PARTIAL_CULTURAL_ANALYSIS` | cultural coherence (brand vs exemplar profiles) **and** a non-empty brand-conditioned list |
| `DESCRIPTIVE_ANALYSIS` | exactly one of those two |
| `INSUFFICIENT_EVIDENCE` | neither |

`CapabilityAvailability` reports each measure as `AVAILABLE`, `INSUFFICIENT`, `EMPTY`, `UNAVAILABLE` or `NOT_COLLECTED`. A partial territory has `relativePosition: null`, `classification: null` and `robustness: null`. These are never zero, and the finalizer never fills them with prose.

**Why ≥ 3 and not the methodology's 2.** With two options every rank percentile is 0 or 1, so the position collapses to a binary order and `CREDIBLE_STRETCH` becomes unreachable.

**The same policy, different routes.** One deterministic policy in the synthetic world yields `FULL_RELATIVE_ANALYSIS` for a move whose references are brand-representable. For a comparison where one concept has only place members and only two are brand-rankable, it yields `PARTIAL_CULTURAL_ANALYSIS` with a `PLACE_PANEL`. On live Qloo, the same rules produced tag-derived brand panels for some concepts and place panels for others.

## Evidence Sufficiency

`assessEvidenceSufficiency(state)` returns:

- `NEEDS_USER_INPUT`: an open ambiguity;
- `BUDGET_EXHAUSTED`: work remains but iterations or Qloo calls are spent;
- `INSUFFICIENT`: for example, the brand is unresolvable after 2 attempts, or nothing measurable exists;
- `SUFFICIENT`: every in-scope territory is analyzed; for a frontier search, also ≥ 3 supported candidates or no room for more;
- `MORE_EVIDENCE_USEFUL`: everything else, with concrete next steps.

The runtime enforces the verdict:

- once `SUFFICIENT`, Qloo tools are refused;
- `INSUFFICIENT` and `BUDGET_EXHAUSTED` end the loop;
- if the model keeps calling tools after `SUFFICIENT`, the runtime finalizes;
- sufficiency reached exactly at the iteration limit finalizes without an extra turn.

## Bounded Autonomy

| Limit | Default |
| --- | --- |
| `maxAgentIterations` | 8 |
| `maxQlooCalls` | 20 (`analyze_move`), 30 (`compare_territories`, `explore_frontier`) |
| `maxRepresentationAttemptsPerTerritory` | 3 |
| `maxCandidateTerritories` | 6 |
| `maxExemplarsPerTerritory` | 3 |
| `maxRetryPerToolCall` | 1, retryable errors only |
| `maxActionsPerTurn` | 12 (one turn may batch tool calls; terminal actions must be last) |
| `maxInvalidTurns` | 2 consecutive |
| `toolTimeoutMs` | 300 000 |

All limits can be set per request (`limits`). Retries never exceed the Qloo budget. Analysis plans its Qloo calls against the remaining budget:

1. Required evidence comes first: the brand profile, one profile per exemplar of each territory, and panel A.
2. If the required evidence does not fit, the rank panels are dropped and the territories are analyzed partially.
3. Optional evidence is then collected in priority order: robustness panels B and C, then target alternates, then target conditioned lists, then reference alternates, then reference conditioned lists, then the repeat panel.
4. Anything not collected is reported as `NOT_COLLECTED_BUDGET`.

If iterations run out, represented territories still get a deterministic analysis when the Qloo budget allows, because analysis needs no model decision.

## Failure Recovery

| Failure | Behaviour |
| --- | --- |
| entity not found | `needs_input` without candidates → `brand.notFound`; ask the user or retry with another name; after 2 failed attempts the run ends `INSUFFICIENT` |
| ambiguous entity | resolved only when exactly one candidate has the requested type (`unconfirmed`, flagged `BRAND_RESOLVED_BY_TYPE_EVIDENCE`); otherwise `NEEDS_INPUT` with candidates. Resolving a candidate before the user answers is refused. |
| tag ambiguity / no tag | the model chooses among observed tags; an unresolvable territory is dropped as `TERRITORY_UNRESOLVED` and stays visible |
| empty recommendation | the pool is recorded as empty; the strategy falls to `DESCRIPTIVE_ONLY` or a place pool |
| wrong entity type | `MIXED_ENTITY_TYPES` |
| insufficient exemplars | robustness `INSUFFICIENT`, or concept-level route |
| Qloo `partial` / `degraded` | flagged (`QLOO_PARTIAL` / `QLOO_DEGRADED`) in run limitations |
| retryable error | retried once (rate limit waits) |
| non-retryable error | the tool fails; dependent evidence stays absent |
| invalid model JSON / prose | invalid turn; 2 consecutive → `FAILED` |
| unsupported tool call | `UNKNOWN_TOOL` / `UNAUTHORIZED_TOOL` refusal |
| budget exhaustion | `BUDGET_EXHAUSTED` with whatever is analyzable |
| methodology incompatibility | `METHODOLOGY_NOT_APPLICABLE`; the territory falls back to partial |
| runtime exception | `FAILED` with the error in the trace; never a crash at the API |

## Claim Validation

`validateClaims` runs on every model synthesis before it is returned:

- territory notes must name territories of the run;
- class language ("credible stretch" and the others) must sit in the same sentence as a territory whose deterministic class is exactly that class, and never with a territory that has no class;
- robustness and evidence-quality levels must match the named territory's computed level;
- every number must appear in the deterministic results (digits inside names are ignored), and percentages are refused;
- probability, certainty, guarantee, consumer-behaviour, outcome-prediction, score/index, confidence, distance and path language is refused.

A failing synthesis gets one retry with the violations as feedback, then the deterministic template is used. The template is tested to always pass the validator. Values in the result are always copied from code, so even accepted prose cannot change a route, class or number.

## Generalization

| Gate | Test | Result |
| --- | --- | --- |
| G1 no benchmark import | `agent-generalization.test.ts`: import graph from `src/index.ts` and `src/agent/index.ts` never reaches `capture/`, `feasibility/` or benchmark files; no `src` file loads benchmark data | PASS |
| G2 no known-brand branches | benchmark brands, territories and exemplars are absent from `src/agent` (even comments) and from comment-stripped runtime code (one allow-listed calibration-provenance string in `methodology/config.ts`); prompts and tool descriptions are clean | PASS |
| G3 unseen brand | synthetic brands absent from the benchmark run end to end; **live:** Glossier and Le Creuset, unknown to the benchmark, resolved and were analyzed with no code change (runs A1, A3, C2, E1) | PASS |
| G4 unseen territory | synthetic Esports (resolved, single exemplar), Moonlight Rituals (`DESCRIPTIVE_ONLY` → insufficient) and Quantum Gastronomy (`UNSUPPORTED`); **live:** Pottery, Coffee, Stationery, Gardening and Fragrance resolved dynamically; Fashion transparently `DESCRIPTIVE_ONLY` | PASS |
| G5 different paths | same policy: `FULL_RELATIVE_ANALYSIS` (synthetic move) vs `PARTIAL_CULTURAL_ANALYSIS` with `PLACE_PANEL` (synthetic compare); **live:** FULL (C1, E2), PARTIAL with `PLACE_PANEL` (A2), PARTIAL with brand panels (A1, A3, C2), INSUFFICIENT (C2 Fashion) | PASS |

## Benchmark Isolation

Direction is **eval → product**. The runtime contains no benchmark brand, territory, exemplar or label. Its prompts contain no named examples, and it never reads `evals/benchmarks/**`. `pnpm eval:agent` records every decision context a model saw and fails if any contains a benchmark brand, a pinned exemplar or an `expected_*` label (leakage 0). The Sprint 2 capture configuration (`src/capture/elasticity-config.ts`) and the Sprint 0B investigation config remain capture tooling used only by scripts. The import-graph test proves that no API or agent module reaches them.

**Owner-reviewed benchmark corrections:** none were provided with this sprint, so the benchmark labels are unchanged and still pending owner review. Benchmark failures must be classified as `METHODOLOGY_ERROR`, `REPRESENTATION_ERROR`, `QLOO_DATA_LIMIT`, `BENCHMARK_LABEL_ERROR` or `AGENT_ERROR` before any threshold is touched.

## Observability

Each result carries `trace` and `metrics`.

**Trace:**

- run id, intent, interpreted request, model and tool-provider identity, limits;
- status transitions, plan revisions;
- turns with decisions (accepted/rejected, reason summaries, token usage, latency, invalid output);
- tool calls (arguments, status, Qloo operations, correlation ids, attempts, latency, errors);
- resolved entities, territory hypotheses, representation attempts with rejections;
- sufficiency decisions, methodology invocations (panel correlation ids), synthesis source and violations;
- errors, user clarifications.

The trace never holds a key, a raw upstream payload or hidden reasoning: only one-line reason summaries.

**Metrics:**

- volume: `agent_iterations`, `qloo_calls`, `tool_calls`, `retry_count`, `latency_ms`, `model_input_tokens`, `model_output_tokens`;
- quality: `tool_success_rate`, `invalid_actions`, `representation_attempts`;
- territories: `territories_proposed`, `territories_resolved`, `territories_rejected`;
- routes: `full_analysis_count`, `partial_analysis_count`, `descriptive_analysis_count`, `unsupported_count`, `methodology_calls`;
- `budget_exhausted`.

`pnpm agent:run` writes the full result (trace included) to `backend/feasibility-output/` (gitignored, mode 0600) for live runs.

## Evaluation

`pnpm eval:agent` (offline, CI) runs 28 SYNTHETIC scenarios (`evals/agent/scenarios.json`) against a synthetic Qloo world (`evals/fixtures/synthetic/agent/world.json`: fictional names, `SYN-` ids). It uses the scripted model for control-flow and forbidden-behaviour cases, and the baseline policy for end-to-end cases. Categories: intent routing, entity resolution, ambiguity, dynamic territory discovery, exemplar discovery, representation validation, tool selection, insufficient evidence, budget control, final synthesis consistency, generalization, forbidden behaviours.

| Metric | Value |
| --- | --- |
| scenarios passed | 28 / 28 |
| intent routing accuracy | 1.0 |
| valid tool-call rate (baseline policy) | 0.981 (all scenarios: 0.975; the misses are deliberate probes of refused cases) |
| tool argument validity | 1.0 |
| entity resolution success | 1.0 |
| territory resolution success | 0.894 |
| representation success | 0.881 |
| full / partial / descriptive / unsupported rate | 0.511 / 0.277 / 0.064 / 0.149 |
| methodology consistency (independent recomputation) | 1.0 |
| final-claim consistency | 1.0 |
| budget violations | 0 |
| benchmark leakage | 0 |
| generalization scenarios | 7 / 7 |
| avg iterations / Qloo calls | 5.75 / 10.04 |

Acceptance thresholds: every scenario passes; intent routing 1.0; valid tool-call rate ≥ 0.95; methodology consistency 1.0; final-claim consistency 1.0; 0 budget violations; 0 leakage. This eval validates neither Qloo nor a live model.

## Live runs

**Setup.** Seven investigations ran on 2026-10-16 against `https://hackathon.api.qloo.com`, all through `qloo mcp` after the offline host gate (`LIVE_QLOO_HOST_VERIFIED`). Decisions came from the **baseline reference policy**: `model.kind = "baseline"`, so every result carries `AGENT_POLICY_NOT_LLM`. **This is a live validation of the tool boundary, validators, routing and methodology integration. It is not a live agent-model validation.** Full traces are in `backend/feasibility-output/live2-agent-*.json` and `live3-agent-*.json` (gitignored).

| Run | Brand (benchmark?) | Request | Iter. / Qloo calls | Outcome | Routes (strategy) |
| --- | --- | --- | --- | --- | --- |
| A1 | Glossier (unseen) | move → Pottery (unseen) | 7 / 15 | COMPLETE | Pottery PARTIAL (tag-derived brand panel: Emma Bridgewater, Simon Pearce) |
| A2 | Jacquemus (benchmark) | move → Boutique Hospitality | 8 / 17 | COMPLETE | PARTIAL (`PLACE_PANEL` on `interests:qloo:boutique_hospitality`) |
| A3 | Le Creuset (unseen) | move → Coffee (unseen) | 3 → 8 / 17 | NEEDS_INPUT → COMPLETE | Qloo has **two** "Le Creuset" brands, so the run asked; it continued with a scripted answer (the first id). Coffee PARTIAL |
| C1 | Muji (benchmark) | compare Stationery, Coffee, Gardening (unseen) | 7 / 29 | COMPLETE | **all FULL_RELATIVE_ANALYSIS**: positions 1/2/3, robustness LOW for all, so every class is UNCERTAIN_REPRESENTATION_SENSITIVE |
| C2 | Glossier (unseen) | compare Fragrance, Fashion, Wellness | 8 / 21 | COMPLETE | Fragrance and Wellness PARTIAL (only 2 rankable); Fashion INSUFFICIENT (`DESCRIPTIVE_ONLY`: no Qloo members) |
| E1 | Glossier (unseen) | frontier | 8 / 22 | COMPLETE, final sufficiency BUDGET_EXHAUSTED | 2 candidates (Bottoms, Earth Tones), PARTIAL; iterations ran out before more candidates |
| E2 | Patagonia (benchmark brand, unseen frontier) | frontier | 8 / 30 | COMPLETE | **4 FULL**: Mountaineering NATURAL_ADJACENCY (HIGH), Mountaineers CREDIBLE_STRETCH (HIGH), adventure gear CREDIBLE_STRETCH (MEDIUM), Environmental Sustainability CULTURAL_BREAK (MEDIUM), all relative to that set |

**Health of the seven runs:** 0 invalid actions, 0 rejected or failed tool calls, 0 retries, no `partial` or `degraded` statuses from Qloo, every budget respected. Latency was 99–204 s per run, dominated by the 7 s call spacing. A1, C1 and C2 ran on an earlier baseline revision, before the thin-brand-pool → place-pool rule. A2 and A3 were re-run on the final code; the first A3 run had exposed an iteration-overrun bug (9 of 8 iterations), which is fixed and covered by `pnpm eval:agent`.

**What the live runs showed**

- **The whole path works live.** C1 and E2 ran discovery, representation, validation, A/B/C rank panels and the unchanged Sprint 2 methodology on real Qloo evidence, with full provenance (every territory lists its correlation ids).
- **Routes differ by Qloo structure under one policy.** Live runs produced tag-derived brand panels, a place panel and concept-only results. Comparisons with fewer than 3 rankable territories degraded to PARTIAL instead of forcing a ranking.
- **Real ambiguity exists.** "Le Creuset" resolves to two Qloo brands with the same name. The runtime stopped at NEEDS_INPUT and made no silent choice.
- **Concept choice matters.** Exact-name tags exist in several namespaces. Probing pools found the brand-bearing one (`keyword:qloo:pottery`, `product_service:qloo:stationery`, `lifestyle:qloo:gardening`). An earlier rule anchored Boutique Hospitality to a lifestyle tag with one unrelated brand member; the final rule prefers a richer place pool.
- **Weaknesses found (QLOO_DATA_LIMIT / baseline limits).**
  - Live brand tag profiles are dominated by media and music tags with no brand members, so profile-derived references usually fail. No `analyze_move` reached FULL.
  - Pools are id-ordered 20-member windows, so some exemplars are Qloo-linked but semantically weak: Monster Energy and Lawson for Coffee; a zoo and an NGO for Environmental Sustainability.
  - "Mountaineering" and "Mountaineers" are probably near-duplicate concepts that the pool-overlap check could not detect, because their member windows were disjoint.

  A live language model is expected to do better at references and exemplar semantics. That is unmeasured (`LIVE_AGENT_MODEL_VALIDATION_NOT_RUN`).

## Known Limitations

- **No live model validation** (`LIVE_AGENT_MODEL_VALIDATION_NOT_RUN`). Prompt quality, tool-use reliability, invalid-action rates and synthesis behaviour of a real model are unmeasured.
- **The baseline reference policy is not semantically capable.** It cannot invent good references or frontier hypotheses. Live brand tag profiles are dominated by media and music tags with no brand members, so its references often fail and its runs end partial.
- **The pool window.** A tag-only `recommend` returns Qloo's first 20 members in id order. Exemplars are chosen within that window. Qloo-linked is not the same as representative: live Coffee exemplars included an energy-drink brand.
- **Comparison sets are chosen by the agent.** Positions and classes are relative to them and are disclosed per territory. Classes stay PROVISIONAL (Sprint 2 thresholds).
- **Leftover configs.** `src/capture` and `src/feasibility` still hold Sprint 0/2 benchmark capture configs inside `src`. They are unreachable from runtime code (tested), but should move under `evals/` or `scripts/`.
- **Runs live in memory.** A backend restart loses `NEEDS_INPUT` runs.
- **Latency.** Live runs are slow: 7 s call spacing means 1.5–4 minutes per investigation.

## Sprint 4 Readiness

The runtime, tool boundary, validators and evals are in place. Sprint 4 needs:

1. A live model credential and the planned live agent runs (3 moves, 2 comparisons, 2 frontier searches; benchmark and unseen brands), measuring invalid-action rate, Qloo calls and route mix per run.
2. Owner review of the benchmark labels, then a benchmark-through-agent evaluation with the failure classification above.
3. Representation quality work: semantic checks on exemplars, a better pool source than the id-ordered window (ask Qloo), and better reference strategies.
4. Moving capture configs out of `src`.
