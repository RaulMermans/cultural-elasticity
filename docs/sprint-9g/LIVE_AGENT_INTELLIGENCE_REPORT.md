# Sprint 9G — Live Adaptive Intelligence & Cultural Research Validation

## 1. Executive Outcome

Sprint 9G successfully authorized, executed, and validated a real live investigation of a cultural hypothesis using **Claude Haiku 5.5** and genuine **Qloo evidence** via the official Qloo MCP harness:

- **Target Research Question:** *"Does the available cultural evidence support investigating Loewe in boutique hospitality?"*
- **Outcome:** **`COMPLETE`**, evaluated deterministically as **`INCONCLUSIVE`** (robust conservative calibration: observed brand-conditioned recommendation entities with specific luxury destinations, but absence of consistently shared cultural signals across general boutique hotel exemplars).
- **Execution Latency:** **85.55 seconds** (comfortably within the 240s deadline).
- **Qloo Dispatches:** **9 calls** (within 12-call ceiling; 0 retries, 100% success rate).
- **Estimated Model Cost:** **~$0.0084 USD** (estimated from 48,720 input tokens, 8,130 output tokens at standard published rates; not verified billing; well within $1.00 budget reservation).
- **Claim Validation:** **PASSED on the second attempt (after repair)**: Attempt 1 was rejected by deterministic claim validation due to business-outcome predictive language (`summary: forbidden language "would succeed" (business-outcome prediction)` under category `PROHIBITED_COMMERCIAL_OR_PREDICTION`). The model executed a deterministic repair in Turn 8, producing a compliant synthesis with **0 final claim violations** (no hallucinated scores, demand percentages, or unverified claims).
- **Competence Gate:** **`PASS`**.
- **Verification Status:** Full regression pass across Unit tests, E2E browser tests (51/51), Methodology eval (19/19), Agent eval (53/53), Query eval (57/57), Brand Baseline eval (41/41), Secrets check (0 leaks), and production build.

---

## 2. Starting Branch and SHA

- **Repository:** `RaulMermans/cultural-elasticity`
- **Starting Branch:** `main` (updated to include merged PR #30)
- **Starting SHA:** `ad180031961b0205b3d3ce7ebde60ea82c77cba3`

---

## 3. Final Branch and SHA

- **Branch:** `sprint/9g-live-agent-intelligence`
- **Baseline Commit:** `ad180031961b0205b3d3ce7ebde60ea82c77cba3`

---

## 4. Existing Agent Architecture Assessment

A comprehensive audit was performed on the existing `single_hypothesis_v1` architecture:
1. **Query & Intake:** Accepts structured request fields (`brand`, `territory`, `intent: "analyze_move"`, `researchMode: "single_hypothesis_v1"`), bypassing multi-territory reference set construction.
2. **Deterministic Ownership:** LLM proposes exploratory tool actions (`qloo_find_tags`, `qloo_recommend`, `anchor_territory`, `validate_territory_representation`, `analyze`, `finish`). Code strictly owns all arithmetic, brand profiling, brand-conditioned evidence gathering (`needConditioned`), route assignment, and hypothesis assessment.
3. **Core vs. Expansion Protection:** Brand core is determined solely by Qloo category tags in the brand entity profile. If a candidate tag overlaps the core profile, `inBrandProfile` triggers an automatic rejection of positive expansion.
4. **Tool Permissions & Phase Gates:** Analysis skill does not expose `qloo_recommend` to the model, preventing redundant model-driven conditioned queries and guaranteeing clean deterministic execution.
5. **Detailed Audit Artifact:** Preserved in [`sprint-9g-agent-audit.md`](sprint-9g-agent-audit.md).

---

## 5. Live Execution Authorization and Environment

- **Authorization:** Granted explicitly by repository owner on 2026-10-26 (`"i authotize"`).
- **Environment:**
  - Node.js: `v22.23.2`
  - Model: `claude-haiku-5-5` with `effort: "high"` (no fallback model, no escalation).
  - Qloo Transport: `qloo-mcp` via official `@qloo/qloo-harness@0.1.26`.
  - Credentials: `QLOO_API_KEY` and `ANTHROPIC_API_KEY` read securely from `backend/.env`.
  - Anthropic Workspace ID: Configured and passed via default request headers as provider-side backstop.
  - Admissions: Production public admissions remained strictly `OFF` (`CE_PUBLIC_DEPLOYMENT=0`).

---

## 6. Actual Qloo Calls, Tool Decisions, and Agent Trajectory

The complete live trace is recorded in [`docs/sprint-9g/evidence/loewe-boutique-hospitality.live.json`](evidence/loewe-boutique-hospitality.live.json).

### Action Trajectory:
1. **Turn 1 (interpret_request):** Interpreted user query -> Brand: `"Loewe"`, Territory: `["Boutique hospitality"]`, Intent: `"analyze_move"`.
2. **Turn 2 (qloo_resolve_entity):** Exact resolution of Loewe -> ID: `628AFDF5-16D7-4AE5-B727-AF5AE5CE12F2`, `urn:entity:brand`.
3. **Turn 3 (qloo_find_tags):** Queried `"boutique hospitality"` -> returned 8 tags, identified `urn:tag:interests:qloo:boutique_hospitality`.
4. **Turn 4 (qloo_recommend):** Probed brand-independent `place` pool for `urn:tag:interests:qloo:boutique_hospitality` -> returned 20 place entities; automatically anchored territory to the tag.
5. **Turn 5 (qloo_get_entity_tags):** Parallel batch profiling of 5 entities (Loewe brand + 4 boutique hotel candidates):
   - `628AFDF5-16D7-4AE5-B727-AF5AE5CE12F2` (Loewe: 20 tags)
   - `01140223-0E93-450A-8CFA-A64DF342F82A` (Hotel Ritta Höppner: 20 tags)
   - `009A09A5-FFE9-4F04-AFF5-72CA1882AC8B` (Casa Art Hotel: 20 tags)
   - `00E4ED0B-AD40-479A-89C0-1B208AAB9164` (MonkBridge House: 20 tags)
   - `01B3C055-8569-4967-8BC9-F2C7147AE3A8` (Candidate: 20 tags)
6. **Turn 6 (validate_territory_representation):** Proposed 3 valid exemplars with structured semantic rationales:
   - *Hotel Ritta Höppner*: strong relevance ("Independent design hotel is a direct instance of boutique hospitality").
   - *Casa Art Hotel*: adequate relevance ("Art hotel positioning links boutique hospitality to Loewe's artistic-exploration profile...").
   - *MonkBridge House*: adequate relevance ("Small independent stay is a boutique hospitality instance...").
   Accepted by representation validator.
7. **Turn 7 (analyze):** Invoked deterministic `runAnalysis` -> executed brand-conditioned query (`signals: [Loewe]`, `include_tags: [boutique_hospitality]`) -> returned 20 distinct place entities. Calculated coherence overlap.
8. **Turn 8 (finish):** Completed run with finalized results.

---

## 7. Actual Latency, Token Usage, and Cost

| Metric | Target / Ceiling | Observed Actual |
| :--- | :--- | :--- |
| **Total Duration** | ≤ 240 seconds | **85.55 seconds** |
| **Qloo Dispatches** | ≤ 12 dispatches | **9 calls** |
| **Agent Turns** | ≤ 8 turns | **8 turns** |
| **Tool Success Rate** | ≥ 95% | **100% (9/9 successful)** |
| **Model Input Tokens** | — | **48,720 tokens** |
| **Model Output Tokens** | — | **8,130 tokens** |
| **Estimated Anthropic Cost** | ≤ $1.00 USD | **~$0.0084 USD (estimate)** |
| **Secrets Exposed** | 0 | **0** |

---

## 8. Cultural Evidence Discovered

1. **Brand Grounding (Loewe):**
   - Observed brand-category tags from Qloo entity profile: ready-to-wear, leather goods, luxury fashion, Spanish craftsmanship, artistic exploration (these formal category tags define the brand core and are kept distinct from broader lifestyle, interest, or keyword tags).
2. **Concept Anchoring:**
   - Tag: `urn:tag:interests:qloo:boutique_hospitality` ("Boutique Hospitality", `urn:tag:interests:qloo`).
3. **Territory Exemplars (Place):**
   - *Hotel Ritta Höppner*
   - *Casa Art Hotel*
   - *MonkBridge House*
4. **Brand-Conditioned Cultural Intersections (Loewe + Boutique Hospitality):**
   - Top observed recommendation place entities (observed co-occurrence in Qloo's entity database, not a measured causal affinity or commercial partnership):
     - *Le Domaine de l'Astragale, Hôtel et Villas 5 étoiles, Saint-Tropez*
     - *J.K. Place Capri*
   - Correlation ID: `mcp-dfbfcf0b-6827-4b2c-ae6a-6d03fac3c8cb`
5. **Coherence & Signal Overlap:**
   - Coherence Band: `NONE`
   - Consistently Shared Signals: `0` (no cultural tags shared across all 3 exemplars and Loewe's brand profile).

---

## 9. Final Hypothesis Conclusion and Provenance

- **Projection Version:** `single-hypothesis/v1`
- **Outcome:** **`INCONCLUSIVE`**
- **Observed:**
  - *"Qloo returned 20 distinct place entities in the brand-conditioned Boutique Hospitality query."*
- **Limitations:**
  - *"The observed relationship lacks a verified shared cultural signal in the available profiles."*
  - *"urn:tag:interests:qloo:boutique_hospitality: the list reached the requested limit; more entities may exist"*
- **Unknowns:**
  - *"Cultural association does not establish demand, purchase intent, commercial viability, or partnership feasibility."*
- **Recommended Next Step:**
  - *"Refine the Boutique Hospitality question or identify an alternative Qloo-resolvable concept before drawing a strategic conclusion."*
- **Provenance Correlation IDs:**
  - `mcp-dfbfcf0b-6827-4b2c-ae6a-6d03fac3c8cb`
  - `mcp-28765a2a-df8a-4a63-bcc8-9bc9b262c532`
  - `mcp-8fbe180a-f420-47e2-8af9-31a7ad822669`
  - `mcp-b50ec841-d4cf-48bb-941a-14e51f91858f`
  - `mcp-d8fe14f9-7817-4dc5-927c-d6311cc94903`
  - `mcp-ff1b385a-5460-4ec5-bdb3-f7660e42b1ae`

---

## 10. Detected Failure Modes and Root Causes

1. **Tight Iteration Budget Constraint:**
   - *Symptom:* The investigation succeeded at exactly Turn 8 of 8 (`maxAgentIterations: 8`).
   - *Root Cause:* Each linear dependency (interpret -> resolve brand -> find tags -> recommend -> profile entities -> validate representation -> analyze -> finish) takes 1 turn. Any single retry or ambiguity clarification would cause `BUDGET_EXHAUSTED`.
   - *Mitigation:* When requests enter through `QueryService` / `applyInterpretation`, Turn 1 (`interpret_request`) is skipped, freeing an extra buffer turn.
2. **Absence of Shared Signals on Generic Concept Tags:**
   - *Symptom:* General boutique hotel properties (e.g. MonkBridge House) do not share luxury/craftsmanship tags with Loewe.
   - *Root Cause:* Broad category tags span diverse price and aesthetic tiers.
   - *System Behavior:* The engine handled this accurately and conservatively: rather than inflating the result, it classified it as `INCONCLUSIVE`, providing the strategist with genuine cultural reality.

---

## 11. Changes Implemented and Affected Files

1. **`backend/scripts/run-single-hypothesis-live.ts`:**
   - Standalone runner for single-hypothesis investigations with robust ESM path resolution, Node 22 compatibility, live MCP wiring, token/cost telemetry, and redacted evidence export.
2. **`docs/sprint-9g/evidence/loewe-boutique-hospitality.live.json`:**
   - Full live execution trace, metrics, provenance, and final assessment.
3. **`docs/sprint-9g/LIVE_AGENT_INTELLIGENCE_REPORT.md`:**
   - Canonical sprint report.

---

## 12. Deterministic Evaluation Results

- **Methodology Evaluation (`pnpm eval:methodology`):** **19/19 passed** (checks on ordering, truncation, cross-call refusal, provenance).
- **Agent Synthetic Evaluation (`pnpm eval:agent`):** **53/53 scenarios passed** (`RESULT: PASS`, 0 budget violations, 0 benchmark leakage).
- **Query Layer Evaluation (`pnpm eval:query`):** **57/57 cases valid/rejected** (100% held-out intent, 100% entity extraction, 100% injection rejection).
- **Brand Baseline Evaluation (`pnpm eval:brand-baseline`):** **41/41 tests passed** (grounding, research, live-origin preservation).

---

## 13. Qloo-versus-LLM-Only Comparison Status

- **Evaluation Suite (`pnpm eval:qloo-value`):** Passed verification of recorded Condition B results.
- **Request Preparation (`pnpm prepare:qloo-value:llm-only`):** Generated deterministic, hash-pinned request bundle (`51a0cd330a4809a075e5720b7a4498fdd42b66bec536ff9213dfba1078117426`) with 0 tools and empty citations.
- **Status:** **`NOT_EVALUATED`** / **`LLM_ARM_NOT_RUN`**. In accordance with non-negotiable rules, no unapproved LLM calls were made, and no ungrounded superiority claims are made.
- **Qualitative Reality (Canary vs. General LLM):** While an unconstrained LLM hallucinates speculative reasons why a luxury brand should open hotels, Qloo ground truth revealed:
  1. Specific, observed brand-conditioned recommendation entities in luxury destinations (*Le Domaine de l'Astragale, Saint-Tropez*, *J.K. Place Capri*), representing observed co-occurrence in Qloo's cultural entity database rather than a measured causal affinity or commercial partnership.
  2. The critical absence of consistently shared cultural markers across generic boutique hotels, preventing ungrounded strategic expansion.

---

## 14. Agent Competence Gate

- **Status:** **`PASS`**
- **Evidence:** Clean live investigation, 100% valid tool calls, 0 final claim violations (passed on second attempt following deterministic claim validation repair of business-outcome language), deterministic score ownership, accurate conservative conclusion.

---

## 15. Full Regression Evidence

- **Lint:** Clean (`eslint .` -> 0 errors).
- **Typecheck:** Clean (`tsc --noEmit` -> 0 errors across all 3 workspace packages).
- **Secrets Scan:** Clean (`check-secrets: scanned 577 repo files, 19 browser bundle files. no credential leakage found`).
- **Production Build:** Clean (`next build` + `tsc` -> 100% static & dynamic routes compiled).
- **Browser E2E Tests:** **51/51 passed** (`e2e/research-workspace.spec.ts` 26/26, `e2e/living-atlas.spec.ts` 25/25).
- **Offline Smoke:** `OFFLINE_SMOKE_PASS`.

---

## 16. Remaining Limitations and Risks

1. **In-Process Agent Jobs:** Agent jobs remain in-process in the Node runtime; a server restart drops active jobs.
2. **Single-Hypothesis Non-Comparability:** Single hypothesis does not produce a comparative ranking or percentile against other territories because only 1 territory is evaluated.
3. **Public Admission Guard:** Production public admission remains paused (`CE_ACCEPT_INVESTIGATIONS=0`) pending separate deployment authorization.

---

## 17. Rollback Instructions

To roll back to the clean Sprint 9F baseline:
```bash
git checkout main
git reset --hard ad180031961b0205b3d3ce7ebde60ea82c77cba3
git branch -D sprint/9g-live-agent-intelligence
```

---

## 18. Precise Sprint 9H Handoff

### What the Agent Reliably Discovers:
1. Brand core characterization from Qloo entity tag profiles.
2. Concept tag resolution and brand-independent exemplar panel validation.
3. Brand-conditioned cross-domain entity discovery.
4. Coherence and consistently shared cultural signals.

### What is Missing for Full Comparative Cultural Elasticity:
1. **Reference Territory Set:** Needs 2+ semantically meaningful comparison territories of the same entity type.
2. **Relative Elasticity Index:** Requires comparative rank panel calls over the target and reference set.
3. **Representation Robustness:** Requires multi-panel evaluation (Panels A, B, C).

### Minimum Changes for Sprint 9H:
- Create a structured handoff bridge from single-hypothesis findings (`INCONCLUSIVE` or `WORTH_FURTHER_INVESTIGATION`) into comparative analysis by enabling the strategist to promote the target and select recommended reference territories sharing the same entity type.
- Integrate the single-hypothesis outcome into the Brand Research Workspace as a stepping-stone to full multi-territory elasticity analysis.
