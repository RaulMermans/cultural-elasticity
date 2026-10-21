# AGENTS.md

Rules for any human or AI agent working in this repository.

## Priorities

**Qloo evidence first. Methodology second. Agent third. Interface fourth.** Methodology comes before polish.

## Non-negotiables

1. **Never fabricate Qloo evidence.** No invented entity IDs, tags, affinities, schemas or "example" responses presented as real. Synthetic test fixtures must be labelled SYNTHETIC, use placeholder IDs, and live under `backend/tests/fixtures/synthetic/` (unit tests) or `evals/fixtures/synthetic/` (methodology evals and the agent's synthetic world, `"fixtureType": "synthetic"`). Agent eval scenarios live in `evals/agent/` and are labelled synthetic too.
2. **Deterministic code owns every number.** Scores, rankings, overlaps and any future Elasticity metric are computed by tested code from Qloo evidence.
3. **LLMs may not invent core scores.** The agent may choose what to investigate and may interpret an evidence packet. It may not produce, adjust or "estimate" a metric.
4. **No secrets in the repo, logs, prompts, docs or fixtures.** `QLOO_API_KEY` is read only by the backend and the Qloo harness child process. Run `pnpm check:secrets` before committing.
5. **Report mocked and live validation separately.** Never describe fixture-based results as live, and never call work complete on mocks when live validation is required. If live validation could not run, say `LIVE_QLOO_VALIDATION_NOT_RUN` and list what is unverified.
6. **Do not present unsupported metrics as fact.** Qloo exposes no graph distance. Use "Cultural Distance Proxy" and "Qloo-supported intermediate cultural signals", never "distance" or "path".
7. **Preserve provenance.** Every Qloo-derived number keeps the correlation ID of the call it came from, and affinities are compared only within one call.

## Generalization (permanent, from Sprint 3)

1. **No benchmark-specific brand, territory, exemplar or label** may be encoded in production methodology or agent logic.
2. **Benchmark data may only be imported by evaluation code.** Direction is eval → product, never product → eval (`tests/agent-generalization.test.ts` enforces it).
3. **The runtime resolves entities and territory representations dynamically** from Qloo evidence.
4. **Different cases may follow different evidence and methodology routes.** Never force one fixed workflow on every territory.
5. **Unsupported evidence degrades capability; it never triggers fabrication.** Missing measures are reported as unavailable, never as zero or prose.
6. **LLM output never owns deterministic numerical truth.** Routes, positions, robustness, quality and classes come from code.
7. **Every agent claim must trace to a deterministic result or to Qloo evidence.** Model synthesis passes the claim validator or is replaced by the deterministic template.
8. **Adding a new Qloo-resolvable brand or territory must not require methodology code changes.**

## Agent runtime and skills (permanent, from Sprint 4)

1. **The runtime owns truth and control; the model proposes actions.** State, permissions, tool availability, budgets, retries, validation, methodology, sufficiency, claim validation and stopping belong to code.
2. **Skills are bounded, reusable competencies, not autonomous agents.** Each declares its tools, actions, context needs, budget, stopping conditions and failure modes (`backend/src/agent/skills/`).
3. **Tools stay atomic and typed.** A skill groups tools; it never becomes a tool or a script.
4. **Only relevant skills and tools enter model context.** Skills are selected just in time from state; the executor refuses tools no active skill exposes.
5. **No benchmark-specific logic in the production runtime.** Capture configs, feasibility pins and the synthetic world live in `backend/scripts/`, never in `backend/src/`.
6. **Representation quality must be validated** (`representation-quality.ts`) before a panel is used; a weak panel is never forced through to reach a fuller route.
7. **Different cases may use different evidence paths** (entity types, recovery strategies, concept-only evidence).
8. **Unsupported cases remain unsupported.** Hypotheses without Qloo support are dropped, never analyzed as real.
9. **Runtime decisions and skill versions must be traceable** (per turn and per tool call).
10. **Skill improvements require eval evidence before promotion.** Changing a skill's procedure, tools, stopping conditions or output semantics bumps its version.
11. **No automatic self-modification.** No skill, prompt or memory is edited by the runtime or the model; `SkillEvalOutcome` is an offline review input only.
12. **No model output may override deterministic methodology.** Model judgments (semantic relevance, concept duplicates) are advisory, stored apart from Qloo evidence, and combined only by explicit rules that can remove, never add, support.

Agent runs report the model honestly: a run driven by the scripted model or the baseline reference policy is not a live agent-model validation (`LIVE_AGENT_MODEL_VALIDATION_NOT_RUN`).

## Model and semantic validity (permanent, from Sprint 5A)

1. **Claude Haiku 5.5 (`claude-haiku-5-5`) is the sole production model.** No fallback model, no escalation, no router. `AGENT_MODEL` may override it for development only; readiness is judged on Haiku runs alone, and model id and effort are recorded in every trace.
2. **Structural validity is not semantic validity.** A FULL relative analysis also requires the SemanticComparisonValidator (`semantic-comparison.ts`) to accept its comparison set. Venue-listing attributes and operational tags are never references, and a reference needs a Qloo tie to the question. A model judgment can veto a reference; it can never make one meaningful.
3. **An honest PARTIAL beats a misleading FULL.** Do not optimize the FULL rate. Evaluations report semantically valid and invalid FULL results and meaningful PARTIAL results separately from the historical route mix.
4. **Readiness needs complete, case-matched evidence.** Every prescribed case must run on the readiness model, errors and omissions stay in the denominator, the baseline covers the same cases, and frontier stability is measured. Anything less is `AGENT_MODEL_NOT_READY`.
5. **Numbers are grounded per scope.** A claim may only use values of the territory (and the result fields) it is about. Validator changes need evidence from traces: fix a proven false positive, never relax a rule to raise acceptance.

## Investigation reliability (permanent, from Sprint 5A.1)

1. **Probing is bounded and honest.** At most 3 empty entity types per concept and 6 empty probes per territory with no member (`probe-policy.ts`); then the concept or territory is unsupported. Only answers Qloo returned as empty count: a failed call is never a probe, and a partial or degraded empty answer is "unreliable". A type that returned members is never refused.
2. **Comparisons plan a shared entity type before anchoring** (`representation-alignment.ts`). Alignment is steered (guidance plus one bounded anchor deferral per target), never forced: no type conversion, no tag-as-entity, no cross-call comparison. With no common type, the result stays PARTIAL.
3. **Completion arithmetic is deterministic and counts the open turn** (`turnsAvailable`, `completionCost`). Already-probed usable references need no probe turn. The last turn is reserved for analysis.
4. **Frontier discovery has two stages.** A fixed evidence base (a fixed related take, the first related profiles in Qloo order) feeds a canonical, deduplicated, stably ordered candidate pool, and the model chooses from it or adds hypotheses that Qloo must validate. A candidate's canonical identity is its grounding tag. Aliases are recorded as uncertain and never merged to raise overlap.
5. **Readiness is SAFETY and COMPETENCE** (`agent-readiness-gate-v3`). Competence criteria are defined before a live run and versioned (`evals/agent/stability-criteria.json`). A green gate is never overridden to red by hand: a missing criterion is added to the gate.
6. **Controlled scenarios use real, verified Qloo evidence** (`evals/agent/controlled-cases.json`). They are re-verified live before each run (`PRECONDITION_CHANGED` otherwise) and kept outside the prescribed-case denominator.

## Engineering

- Keep **frontend/backend boundaries clean.** The frontend talks only to the backend. Only the backend talks to Qloo, through `QlooClient` (`backend/src/qloo`).
- Product code depends on the `QlooClient` and `QlooTransport` interfaces, not on shell commands.
- Validate at boundaries (zod). Contracts are derived from verified Qloo output, never designed first.
- Handle Qloo statuses explicitly:
  - `needs_input` is never silently continued;
  - `partial` and `degraded` are flagged;
  - `error` is retried at most once, and only when Qloo marks it retryable.
- Do not add complexity without a measured requirement. No databases, queues, auth or abstractions "for later".
- Keep hackathon scope tight. Smallest reliable change, no unrelated refactors, and never delete tests to make CI pass.

## Verification before calling work done

```sh
pnpm lint && pnpm typecheck && pnpm test && pnpm build && pnpm check:secrets
pnpm eval:methodology   # offline, synthetic; never report as Qloo validation
pnpm eval:agent         # offline, synthetic world; never report as Qloo or live-model validation
pnpm eval:agent:live -- --arms baseline,model --stability 3
                        # live Qloo + Haiku: all 7 cases, case-matched baseline, frontier stability (model arm needs ANTHROPIC_API_KEY)
pnpm feasibility:qloo   # live; report its result separately
```
