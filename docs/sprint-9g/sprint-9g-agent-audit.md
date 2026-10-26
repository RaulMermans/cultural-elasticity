# Sprint 9G — Single-Hypothesis Architecture Audit

## 1. Overview and Purpose

This document provides the formal technical audit of the `single_hypothesis_v1` architecture evaluated in Sprint 9G and preserved for comparative integration in Sprint 9H.

The single-hypothesis capability was designed to investigate a single proposed brand expansion without prematurely forcing multi-territory reference set construction, while upholding all non-negotiable repository rules (deterministic numerical ownership, strict provenance preservation, bounded execution, and zero metric fabrication).

---

## 2. Query and Intake Layer

1. **Structured Request Interface:**
   - Accepts request fields: `brand`, `territory` (single element array), `intent: "analyze_move"`, `researchMode: "single_hypothesis_v1"`.
   - Schema enforcement in `backend/src/agent/contracts.ts` guarantees that `researchMode: "single_hypothesis_v1"` requires exactly one named target territory and rejects multi-territory requests or unexpected modes.
   - When requests enter via `QueryService` / `applyInterpretation`, Turn 1 (`interpret_request`) is deterministically bypassed, conserving agent iteration budget.

2. **Admission and Job Control:**
   - In-process agent jobs in `backend/src/agent/query/jobs.ts` validate `researchMode === "single_hypothesis_v1"`.
   - Admitted requests receive strict ceilings: max 12 Qloo calls and max 8 agent iterations.

---

## 3. Deterministic Ownership vs. Advisory Model Actions

In accordance with `AGENTS.md`:
- **Model Role:** Proposes candidate exploratory tool actions (`qloo_find_tags`, `qloo_recommend`, `anchor_territory`, `validate_territory_representation`, `analyze`, `finish`). The model may propose hypotheses and provide qualitative interpretations of validated evidence.
- **Code Role:** Deterministically computes all numerical metrics, coherence calculations, overlap counts, and sufficiency determinations.
- **Hypothesis Assessment:** `assessSingleHypothesis` in `backend/src/agent/hypothesis-assessment.ts` strictly determines whether the outcome is `WORTH_FURTHER_INVESTIGATION`, `INCONCLUSIVE`, `UNSUPPORTED`, or `INSUFFICIENT_EVIDENCE`.

---

## 4. Core vs. Expansion Protection

1. **Brand Grounding:**
   - The brand core is established solely from Qloo entity tags returned for the brand entity profile (`urn:entity:brand`).
   - Category tags (e.g. ready-to-wear, leather goods, luxury fashion) are strictly distinguished from broader lifestyle or interest tags.
2. **Expansion Guardrail:**
   - If a candidate territory concept overlaps with tags in the brand core profile, `inBrandProfile` triggers an automatic rejection of positive expansion.

---

## 5. Tool Permissions, Phases, and Reference Bypassing

1. **Phase Progression:**
   - `DISCOVERY` -> `ANCHORING` -> `REPRESENTATION` -> `ANALYSIS` -> `SYNTHESIS`.
2. **Reference Strategy Exemption:**
   - In `single_hypothesis_v1`, multi-territory reference set construction is explicitly bypassed in `evidence-sufficiency.ts`, `runtime.ts`, and `skills/definitions.ts`.
   - Reference deferrals are skipped, enabling direct target analysis without requiring competitor or benchmark territory panels.

---

## 6. Claim Validation and Repair Verification

1. **Immutable Trace Evidence:**
   - Trace record: `docs/sprint-9g/evidence/loewe-boutique-hospitality.live.json`.
   - Attempt 1: The model synthesis included forbidden predictive language (`"would succeed"`), triggering deterministic rejection under category `PROHIBITED_COMMERCIAL_OR_PREDICTION` with violation: `summary: forbidden language "would succeed" (business-outcome prediction)`.
   - Repair Turn: The runtime provided deterministic feedback to the model.
   - Attempt 2: The model submitted a repaired synthesis free of forbidden predictions, which passed claim validation with 0 violations.
2. **Metrics Audit:**
   - `synthesis_attempts`: 2
   - `synthesis_first_attempt_valid`: `false`
   - `synthesis_valid_after_repair`: `true`
   - `synthesis_fallback`: `false`

---

## 7. Telemetry, Cost Estimation, and Provenance

1. **Cost Accounting:**
   - Token counts: 48,720 input tokens, 8,130 output tokens.
   - Calculated model cost of $0.0084 USD is an **estimate** based on standard API rate schedules, not verified invoice billing.
2. **Provenance Preservation:**
   - All Qloo dispatches are tied to unique MCP correlation IDs (`mcp-*`).
   - Observed brand-conditioned recommendations are preserved as observations of co-occurring entities in Qloo's database, not as causal relationships or verified customer demand.
