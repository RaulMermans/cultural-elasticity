# Sprint 13: Final release review

**Verdict: `SUBMISSION_READY_WITH_DISCLOSED_LIMITATIONS`**

The deployed product meets every hackathon requirement and gives judges a trustworthy demonstration. The P0 quota hotfix is merged, deployed and production-verified. Three things remain for the owner: merging this branch (optional for eligibility), submitting on Devpost, and deciding whether to approve one small live run (§10). The remaining limitations are documented and noncritical.

| | |
| --- | --- |
| Date | 30 October 2026 (deadline 30 Oct, 11:45 pm ET = 31 Oct, 03:45 UTC = 04:45 Madrid) |
| Release branch | `sprint/13-final-release`, from `main` `9cdb1d9` |
| Final commit | the head of PR "Sprint 13: final release polish and submission package" |
| Production (verified) | `main` `9cdb1d9` on Vercel (READY) and Railway (SUCCESS), CI green |
| Paid provider calls made by this sprint | **None** (no Qloo, no model) |

## 1. Release baseline (Phase 0)

| Check | Finding |
| --- | --- |
| Open PRs | None before this sprint. All 9C–12 sprint PRs and the hotfixes #54, #57 and #58 are merged |
| Sprint 12 and its durability fix | Merged (#56 `8197230`, hotfix #57 `cb470f4`); CI green on `cb470f4` |
| **P0 quota hotfix (#58)** | **Merged as `9cdb1d9` at 19:17Z, CI green, deployed to both Vercel and Railway, verified (§6).** Not a blocker. Its live behaviour (an unsupported question returns its investigation unit) is covered by 10 synthetic backend tests and an E2E test. It was not re-exercised in production, because that needs a paid Haiku interpretation |
| Local `~/Desktop` checkout | Stale (`sprint/9h`), untracked 9F screenshots. Not touched; all work happened in an isolated worktree |
| Hackathon rules (re-read 30 Oct) | Functional demo link; public repo with a detectable open-source license (MIT, public since 29 Oct); English text description; video optional; free, unrestricted testing until judging ends (5 Nov, 11:45 pm ET). The public allowance runs until 6 Nov, 05:00 UTC |

## 2. Product and visual polish (Phase 1)

I audited every judge-facing state at 1440×900 and 390×844 with the synthetic fixture: home, brand resolution, network, direction dossier, running investigation, result, unsupported question and exhausted allowance. I also reviewed the production homepage and both recorded reports. Only defects with evidence were changed.

| # | Defect (evidence) | Fix |
| --- | --- | --- |
| P1 | **The export dropped a reading that the workspace shows.** When the agent named a direction's territory differently from the direction (synthetic: *Slow Touring* → *Gravel Riding*), the dossier showed the full reading but the report said "a reading for 0 territories" | `network-report.ts` uses the dossier's rule (a one-territory answer belongs to its branch). A regression test fails without the fix |
| P2 | **Two labels for one state.** A limited-evidence result read "Limited evidence" and then "**Inconclusive evidence.**" (the decision implication), and the technical section said "Inconclusive" again | The implication is now a decision, "**No decision yet.**"; the technical line reads "No conclusion either way yet". Copy only; no outcome, rule or mapping changed |
| P3 | **Clipped activity markers.** The scrolling step list clipped every step dot by half | The timeline line is drawn inside the list; markers render whole |
| P4 | **First impression.** The home page did not say who the product is for, and explained only the four comparative classes, although most results lead with a direct-evidence conclusion | The lede names brand strategists, insights teams and creative agencies; step 3 and a note separate direct evidence from comparative placement |

Checked with no change needed: the blank-step guard (an empty activity entry is not rendered as a numbered step); the unsupported question ("used no investigation credit", "Edit and ask again"); the exhausted allowance (composer disabled, with the reason); mobile reading order; anonymous production pages (no console errors, no non-GET request).

Not changed, and disclosed: the agent write-up says "1 territory result(s)". The text comes from the runtime finalizer and is stored inside recorded live results and durable journals, so changing it for cosmetics was not worth the replay risk.

### Before and after

| | Before | After |
| --- | --- | --- |
| Home | [production, `9cdb1d9`](release-evidence/home-before-production.png) | [local build](release-evidence/home-after-local-synthetic-allowance.png) (synthetic allowance numbers) |
| Agent activity | [markers clipped](release-evidence/activity-before-synthetic.png) | [markers whole](release-evidence/activity-after-synthetic.png) |
| Conclusion | [repeated label](release-evidence/conclusion-before-synthetic.png) | [conclusion, then decision](release-evidence/conclusion-after-synthetic.png) |

The activity and conclusion images use the SYNTHETIC test fixture (`Larkspur Velo`); they show layout, not evidence.

## 3. Research presentation consistency (Phase 2)

- The workspace, the decision card, the HTML/PDF report and the evaluations all read the same deterministic projections (`evidence-assessment/v1`, `decision-card/v2`). P1 closed the one divergence found, in how a reading is attached to its branch.
- Evidence, measurement and interpretation stay separate on screen: "Evidence measurement" (counts are not strength of fit), "Strategic meaning" (interpretation labelled "reasoning, not evidence"), "Comparative result" ("Not established comparatively" when no valid set exists), and "Technical details" (provenance).
- A partial result is never upgraded through copy: P2 only removed a repeated label.
- The recorded Crocs and Patagonia reports (29 Oct) predate the conclusion-first layout. Their wording differs slightly from today's workspace, but their classes and ranks are the stored values; this is stated wherever they are linked. The README's earlier "Credible stretch, provisional" for Crocs conflated "every class is provisional" with stability. It now says "steady across example sets", matching the report.

## 4. Documentation (Phase 3)

| File | Change |
| --- | --- |
| `README.md` | Rebuilt as the product introduction in the requested 16-part structure, with the live demo, judge-ready examples, an architecture diagram, and evidence assessment versus comparative measurement |
| `docs/README.md` | Current documentation, hackathon submission, live evidence and development history are separated; Sprint 12, the quota hotfix and this review are indexed |
| `docs/architecture.md` | New request path, layers, durability and deployment. The old text said jobs were in-memory, the production alias was unassigned and the MCP transport was "future" |
| `docs/methodology/README.md` | Leads with the current methodology (evidence assessment, comparative measurement, decision card); the history table now runs to Sprint 12 |
| `docs/submission/DEVPOST.md` | Rewritten for the current product and rules; outdated quota numbers (4/4) and research statuses removed |
| `docs/submission/DEMO_STORYBOARD.md` | New: the judge demonstration, the recorded fallback, the asset list with provenance, and the optional recording plan (`VIDEO_PLAN.md` now points here) |
| `frontend/README.md` | The research workspace is the default view; Atlas is `?mode=atlas` |
| `.env.example` | Documents the public evaluation variables and `CE_PUBLIC_QUOTA_QUESTIONS` |
| `AGENTS.md` | Unchanged; it remains the governing contract and agrees with the code |

## 5. Repository hygiene

- No tracked temporary artifacts, logs, `.env` files, build output or `.DS_Store`. `check:secrets` is clean.
- `apps/vercel-feasibility` (a Sprint 8 hosting experiment) is kept as evidence and now labelled in the README; the build already excludes it.
- Development pages under `/dev/` return 404 in production.
- Link check of all current documents: no broken file links or anchors. Two historical Sprint 9I links point to components removed later; they are left as historical record.
- Nothing was deleted. Historical reports, fixtures, datasets, migrations and evaluation artifacts are untouched.
- `frontend/vercel.json` disables Vercel deployments for `sprint/13-final-release`, so pushing this branch creates no public preview.

## 6. Tests and CI

Run locally on the branch head with Node 22.23.2. All are offline or synthetic; none is Qloo or live-model validation.

| Check | Result |
| --- | --- |
| `pnpm lint` | pass |
| `pnpm typecheck` | pass |
| `pnpm test` | pass: backend 1,064/1,064, frontend 119/119 (one new test) |
| `pnpm build` | pass |
| `pnpm check:secrets` | pass (no credential leakage) |
| `pnpm check:deployment-config` | pass (`OFFLINE_DEPLOYMENT_CONFIG_PASS`) |
| `pnpm eval:methodology` | pass (`LIVE_QLOO_VALIDATION_NOT_RUN`: synthetic) |
| `pnpm eval:agent` | pass, 0 runtime evaluator failures (`LIVE_AGENT_MODEL_VALIDATION_NOT_RUN`: synthetic world) |
| `pnpm eval:query` | pass (offline gate replay; not language-understanding evidence) |
| `pnpm test:e2e` | pass, 65/65 (synthetic job API) |
| Durable execution (`test:durable`, disposable PostgreSQL) | Runs in CI on the PR. Not run locally: this sprint changed no backend runtime code |
| GitHub Actions on `main` `9cdb1d9` | success |

**Production verification** (`scripts/release/verify-production.mjs --release 9cdb1d9 --expect-admissions public --public-mode --max-qloo 1000 --max-usd 5.00`, read-only):

```
release 9cdb1d9 | vercel 9cdb1d9 READY | railway 9cdb1d9 SUCCESS (latest SUCCESS) | running 9cdb1d9
ready 200 [] | admissions accepting | anonymous resolve 400 | baseline budget {"limitCalls":408,"usedCalls":50} | ci success
[DEGRADED] VERCEL_PREVIEW_ENV_MISSING:CE_INTERNAL_API_SECRET
RELEASE_DEGRADED
```

The only finding is the long-known Preview-only variable, which does not affect production. With the default ceilings (75 calls, $2) the verifier reports `RELEASE_FAILED`, because those defaults are below the owner-approved public caps. Run it with the approved caps as above.

Public evaluation ledger at verification: **306 of 1,000 Qloo calls, $0.29 of $5.00 model spend**, 0 running jobs.

## 7. Demo verification (Phase 5)

Against the real deployment, with no paid call:

| # | Acceptance item | Result |
| --- | --- | --- |
| 1 | An anonymous visitor reaches the homepage | **Pass**: hosted acceptance, 6/6 on desktop, tablet and mobile; no page errors, no paid request on load |
| 2 | Brand resolution works | **Not exercised live** (a paid Qloo call). Admission verified: malformed requests are refused with 400 before any quota or provider call, and `/api/brands/status` reports the evaluation open |
| 3 | Brand research produces a fingerprint | Not exercised live (paid). Last live proof: Patagonia, 29 Oct (Sprint 9M) |
| 4 | A supported investigation completes within budget | Not exercised live (paid). Last live proofs: Crocs (9L) and 10D L1–L4. **Sprint 12's conclusion-first path has not run live** (`LIVE_QLOO_VALIDATION_NOT_RUN`, `LIVE_AGENT_MODEL_VALIDATION_NOT_RUN`) |
| 5 | An unsupported question uses no investigation allowance | Synthetic backend tests and E2E pass; deployed in `9cdb1d9`. Not exercised in production (paid interpretation) |
| 6 | Remaining allowances are accurate | **Pass (read-only)**: `/api/brands/status` returned this network's own counts (searches 9/20, scans 5/8, investigations 12/12 used), and the homepage displays them verbatim. The new question quota (default 36) is enforced but not displayed; its refusal message names it |
| 7 | Saved investigations reopen | Synthetic E2E (library reopen) passes. Saved research lives in the visitor's browser, so production state is not readable by this session |
| 8 | HTML/PDF exports match the visible research | Unit parity tests pass, including the new P1 test |
| 9 | Mobile navigation and reading | Pass: production homepage and recorded reports at 390×844; synthetic workspace states at 390×844 |
| 10 | The recorded fallback is available | **Pass**: both reports return 200 in production and are linked from the homepage |

This network (the owner's) has used all 12 of its investigations, so a live investigation from here would need the operator credential in any case.

## 8. Production deployment status

- Production runs `9cdb1d9`: Sprint 12 plus the P0 hotfix. Public evaluation `qloo-hackathon-2026` is open until 6 Nov 2026, 05:00 UTC.
- **This branch is not merged or deployed.** It changes presentation and documentation only (no methodology, scoring, policy, spending or agent change). A merge to `main` deploys both Vercel and Railway; after a merge, rerun the verifier with `--release <merge sha>`.
- The submission is valid without this merge. The repository README on `main` is what judges read first, so merging the docs is recommended.

## 9. Remaining limitations (disclosed)

1. **Global public budget.** 694 Qloo calls remain for the whole judging period. That is roughly 20 investigations plus scans at observed sizes (35 calls for the Crocs pair; 30 calls for the largest 10D run). If judges exhaust it, the product says so and the recorded reports still open. Raising it needs an owner decision on spend (`scripts/public-evaluation-open.sh` with new approved caps).
2. Sprint 12's conclusion-first research path has not run live (§7.4).
3. No screenshot of today's conclusion-first result with real evidence. The Devpost result image (`05-reading-not-settled.png`) is real but shows the pre-Sprint-12 layout.
4. Research value remains modest. There is no independent human rating, no Cultural break demonstrated in production, and no LLM-only comparison.
5. Investigations are in-process (durable agent jobs are built but not enabled), and there is one Railway replica.
6. The cosmetic "result(s)" in the agent write-up template.

## 10. Owner actions and approval request

| # | Action | Who |
| --- | --- | --- |
| 1 | Review and merge the Sprint 13 PR; then `node scripts/release/verify-production.mjs --release <sha> --expect-admissions public --public-mode --max-qloo 1000 --max-usd 5.00` | Owner (merge deploys) |
| 2 | Submit on Devpost, using `docs/submission/DEVPOST.md` and the media list. I did not submit anything | Owner |
| 3 | Confirm the GitHub "About" shows MIT and the demo URL | Owner |
| 4 | **Optional live run, needs approval:** one hosted journey with the operator credential (one brand scan, one investigation, save, reopen, export). It would validate Sprint 12's path live and give a current-layout result screenshot. **Ceiling: ≤ 45 Qloo calls and ≤ $0.10 of Haiku**, drawn from the existing public evaluation ledger (the caps do not change). Command: `E2E_HOSTED_URL=… E2E_LIVE_AUTHORIZED=1 E2E_OPERATOR_TOKEN=… E2E_BRAND=<brand> E2E_SKIP_DIRECTION=1 E2E_SECOND_QUESTION="How far can <brand> extend into <territory>?" pnpm --filter frontend exec playwright test -c playwright.hosted.config.ts acceptance --project desktop-1440x900` | Owner approval, then me |
| 5 | Optional: decide whether to raise the global public budget (§9.1) | Owner |

## 11. Submission links

- Live demo: https://cultural-elasticity-raulmermans-projects.vercel.app
- Repository: https://github.com/RaulMermans/cultural-elasticity (public, MIT)
- Recorded reports: [Crocs](https://cultural-elasticity-raulmermans-projects.vercel.app/examples/crocs-2026-10-29.html) · [Patagonia](https://cultural-elasticity-raulmermans-projects.vercel.app/examples/patagonia-2026-10-29.html)
- Devpost text: [DEVPOST.md](DEVPOST.md) · Storyboard: [DEMO_STORYBOARD.md](DEMO_STORYBOARD.md)

## 12. Exact release blockers

**None for submission.** The demo is public and working; the repository is public with MIT; the description, testing instructions and media are ready. The Devpost submission itself is an owner action (§10.2), not a technical blocker.
