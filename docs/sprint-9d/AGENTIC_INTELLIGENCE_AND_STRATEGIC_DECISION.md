# Sprint 9D — Agentic cultural intelligence and strategic decision

## Decision and current outcome

The brand research workspace now leads from a stored baseline direction to a bounded investigation in the existing `AgentRuntime`, then to source-linked findings, a read-only comparison, and a deterministic strategic research brief. This is a hybrid workflow-agent design: the server owns identity, evidence, admission, budgets, tool permissions, methodology, validation, and stopping; Haiku may propose bounded investigation actions and synthesize only validated claims. No new framework, model provider, database service, score, or migration was introduced.

The authorized vertical slice is implemented. A separately approved, bounded **live Loewe baseline canary** and isolated database regression completed on 25 October 2026; see [the canary report](LOEWE_CANARY_REPORT.md). Live agent evaluation, a controlled Qloo-versus-LLM-only comparison, and blind usefulness review remain separate evidence gates. Public agent admission remains off. Recorded and live results are labelled separately.

## Evidence vocabulary

| Term | Meaning in the product |
| --- | --- |
| Brand core | Qloo brand category tags only; absent tags leave core unverified. |
| Observed cultural connection | A returned Qloo association with its call correlation ID and scope. |
| Cultural territory hypothesis | A baseline direction grounded in an eligible source, still `UNVALIDATED`. |
| Agent-investigated territory | A territory the existing runtime investigated through its governed Qloo gateway. |
| Evidence-supported conclusion | A scoped observation or validated synthesis in a completed result; partial evidence remains partial. |
| Unresolved / insufficient evidence | An explicit missing measure, weak representation, incompatible comparison, failed run, or absent support. |

The stored Loewe baseline has a recorded cultural profile and weak Model/Fashion hypotheses, no verified brand core, and no validated adjacent opportunity. The recorded Jacquemus agent example is separate, with partial results. Neither brand's observations are joined into the other's report.

## Handoff and execution contract

`POST /api/agent/handoff/preview` and `/jobs` accept only a scan UUID, territory ID, and idempotency UUID. The baseline access token and internal API authentication remain headers. The backend rereads the scan with `BaselineRepository`, verifies the territory belongs to it, and checks every supporting reference against scan provenance. `ce-deep-investigation/0.1` records the brand name and canonical Qloo ID, scan and territory IDs, objective, eligible references, limitations, authorization scope, and a typed `AgentRequest`. A client cannot submit evidence objects, brand identity, tools, or budgets in this route. The runtime refuses a Qloo resolution to another brand ID.

The UI first previews the validated request. “Start live investigation” is a separate explicit action, subject to agent admission, visitor limits, queue capacity, and spend reservation. A duplicate idempotency key returns the original in-process job; a conflicting territory is refused. The same `QueryService`, `JobManager`, `AgentRuntime`, skill permission gateway, Qloo transport, and claim validation handle the run. The selected baseline hypothesis is starting context, never upgraded to support by selection. The agent must gather fresh eligible evidence. An unsupported direction cannot be initiated from this handoff.

The execution state and the idempotency map are **in process**. Completed job results remain readable only for the configured job TTL while that process lives. A restart loses them; an uncertain provider call is never replayed automatically. Baseline scan durability remains PostgreSQL-backed. No agent crash resume or durable investigation artifact store is claimed. Thus paid investigations stay disabled in public deployment until a separate durability and readiness decision.

## Findings, comparison, and brief

`ce-research-finding/0.1` is a read-only projection of a completed, validated `AgentAnalysisResult`. It keeps the research question, brand and territory, one scoped observation, validated agent interpretations, correlation IDs, analysis route and comparison set, limitations, unresolved question, status, next research step, and origin. Missing source links remove observation and interpretation; no metric is inferred. The UI shows truthful queued/running/preparing/completed states and offers source IDs under disclosure, with no tool chatter or fabricated reasoning stream.

The Atlas compares two or more existing same-brand investigated territories through `assessComparison`. The comparison component has no fetch path. It displays the question, observed connection, coverage, limitations, next validation, and source references for each territory. Cross-call affinities are never combined; the UI offers no numerical ranking or winner. Incompatible evidence stays explicitly incomparable.

The workspace brief contains objective, brand profile, cultural connections, investigated territories, observations, supported interpretations, comparison, unresolved questions, limitations, next research steps, source references, date, and methodology version. It is assembled from the canonical baseline view plus, only for the same canonical brand, a completed live investigation from the current session. The on-screen and exported HTML use the same data; the export escapes untrusted text. Recorded results are identified as recorded. The brief makes no commercial-success claim.

## Qloo value benchmark protocol and present audit

`evals/qloo-value/cases.json` freezes seven historical live Haiku+Qloo results across Rapha, Liquid Death, Oatly, Allbirds, Aesop, YETI, and Le Creuset, with exact research questions and SHA-256 artifact pins. `pnpm eval:qloo-value` checks origin, model, brand, question, checksum, source-linked eligible territories, summary claim validation, rejected claims, and presence of next steps. The report is `evals/qloo-value/report.json`.

The offline audit found 7/7 cases with source-linked eligible territories, 7/7 accepted summaries passing the recorded validator, one rejected summary claim, and 7/7 with a proposed next step. These are **historical condition B audit results**, not a causal or head-to-head Qloo value result. Condition A (LLM-only) is `NOT_RUN`; no comparative effect, unsupported claim rate, usefulness score, or actionability advantage is reported.

To complete a fair comparison, run condition A only after a separate model-spend approval. Use the exact frozen questions, Haiku 5.5, a fixed token cap and output schema, identical instruction wording except evidence access, and no Qloo tools or Qloo observations. Record the full output, model ID, token usage, cost, date, and prompt checksum. The two arms still differ in source access and context and should be described as a practical comparison, not a controlled causal experiment. Apply deterministic source and claim checks where possible. For research usefulness, cultural specificity, calibration, and actionability, obtain a blind human review in randomized arm order: score each 1–5 against an explicit rubric, record written reasons and adjudicate disagreement without exposing the arm label. The model under review cannot be its sole judge. **Blind human review is NOT_EVALUATED.**

## Controlled live plans requiring approval

**Loewe v2 Qloo baseline canary:** use the existing `backend/scripts/baseline-canary.ts`, the latest verified baseline template, and a fresh isolated approved PostgreSQL database with zero prior reserved calls. One brand resolution, one `entity_tags` request with limit 20, four `recommend` domains, at most **7 total Qloo dispatches including retries**, zero Anthropic calls. Stop on any unknown dispatch, contract drift, or seven reservations. Inspect returned `subtype`, recorded request type, tags 11–20, call IDs, integrity, and research usefulness; preserve all stored normalized artifacts and rerun offline evaluation. The script calls `migrate`, so both the isolated DB migration and the seven-call live Qloo run require specific approval. No optional artist enrichment is included.

**As run:** the owner approved exactly this bounded canary. The local database identity was verified before migration, and the run completed with six Qloo calls, zero retries, zero Anthropic calls, 40 provider-confirmed entity subtypes, 20 tags, and a `COMPLETE` stored result. All source links passed an independent audit. The cultural profile improved, but the five single-tag hypotheses still do not establish a useful adjacent expansion direction. No optional enrichment or agent run followed. The complete normalized evidence and the post-run export recovery are documented in the [canary report](LOEWE_CANARY_REPORT.md).

**Agent evaluation:** a separately approved, non-public run would investigate one selected baseline hypothesis on a persistent local backend, with only the current runtime's permitted read-only Qloo tools, Claude Haiku 5.5, the existing runtime call/turn limits, a 20-minute job limit, and a preflighted exact USD ceiling. Stop on provider unknown outcome, exhausted budget, invalid scope, cancellation, or missing eligible evidence. Record actual trace, correlation IDs, tokens, provider calls, latency, and observed spend. A fresh run must not inherit baseline hypothesis support and may legitimately end PARTIAL or INSUFFICIENT. No amount is authorized by this document; the ceiling and call reserve must be presented for explicit approval before dispatch.

## Failure and security behavior

No suitable territory disables handoff. Missing or mismatched scan/token yields no scan. Mismatched territory or provenance is refused. Duplicate job initiation is idempotent within the process; conflict is refused. Admission pause, spend gate, queue limit, provider error, cancellation, and expiry keep their existing closed states. The UI does not convert a failed or insufficient result into a conclusion. A backend restart loses in-process jobs, including the new handoff idempotency memory. A database outage makes new scan reads unavailable; stored baseline rows are not rewritten. A recorded Jacquemus result cannot attach to the Loewe brief. The browser sees neither Qloo nor Anthropic credentials; the Next.js server proxies with internal authentication. The public deployment must retain `CE_ACCEPT_INVESTIGATIONS=0`, `CE_BASELINE_ENABLED=0`, `CE_BASELINE_LIVE_ENABLED=0`, and `CE_BASELINE_TOTAL_QLOO_CALLS=0` until separately authorized.

## Demo and performance

For an immediate, honest demonstration, open the recorded Loewe workspace to show observed connections and weak directions, then open the **separately labelled** recorded Jacquemus Atlas to show an actual agent investigation, partial findings, side-by-side comparison, and source disclosure. Export the Loewe brief as baseline-only; do not narrate it as a combined Jacquemus investigation. The selected direction live handoff can be shown in an authorized local environment, but no new live result is claimed.

Recorded content opens without a provider call. The Sprint 9D Loewe baseline canary used six Qloo dispatches (one resolution plus five scan stages); the scan stages took about 33.5 seconds, with no Anthropic usage. Qloo monetary cost was not measured. Historical Sprint 8E Jacquemus live parent: 256 seconds, 32 Qloo-call budget exhausted, three PARTIAL and zero FULL, $0.0172 observed model cost. It is a prior measurement, not a Sprint 9D agent success or a cost forecast.

## Verification and release gates

Final local verification on 25 October 2026: `pnpm lint`, `pnpm typecheck`, `pnpm build`, and `pnpm check:secrets` passed; the secrets scan covered 529 repository files and 19 browser bundle files. `pnpm test` passed 71 frontend and 801 backend tests across 64 backend test files. `pnpm test:e2e` passed 46 browser cases, including no-provider comparison, handoff preview, recorded/live labels, keyboard use, and desktop/tablet/mobile screenshots in `screenshots/`. A manual Playwright MCP pass opened recorded Loewe research and its brief; with the standalone frontend dev server, brand status returned 503 because no backend was running, while recorded research remained usable. `pnpm eval:methodology` passed 19/19 synthetic checks; `pnpm eval:agent` passed 53/53 synthetic scenarios; `pnpm eval:query` passed its offline gate thresholds with one adversarial label mismatch (X06); `pnpm eval:brand-baseline` passed 41/41; `pnpm eval:qloo-value` reproduced the frozen audit; `pnpm smoke:offline` passed. These are offline results, not new live Qloo or Haiku validation.

After the owner approved isolated local migration, `pnpm test:db` passed **16/16** against a dedicated regression database in a fresh PostgreSQL 16.14 cluster. A separate fresh database was positively identified before the live canary migration. The local PostgreSQL process was stopped after exporting and verifying the evidence; its files were retained. The Sprint 9D Git preview at `c0e37c8` was READY behind Vercel Authentication **All Deployments**, and two anonymous probes returned 401. The canary follow-up code and evidence are local only: they were not pushed or deployed. Cloud CI has not been reported as green.

Sprint 9E checklist, with no action authorized here: decide public demo admission and spend cap; audit repository secret history and rotate affected credentials; verify license; resolve GitHub Actions billing; align reviewed code on `main`; explicitly decide whether Vercel protection changes; check Railway health, one replica, database backup/restore and admission flags; run anonymous hosted E2E and provider rate-limit tests; prepare video, Devpost copy, screenshots, and a reproducible benchmark with human review. Do not release publicly or start 9E without a separate decision.
