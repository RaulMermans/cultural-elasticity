# Sprint 9M: public evaluation, live evidence

**These are live runs with real providers.** A real browser, acting as an **anonymous visitor** with no operator credential, used the production Vercel frontend. The frontend called the Railway backend at `e65994f`, which called Qloo (hackathon host) and Claude Haiku. Nothing was stubbed.

## The public evaluation

| | |
| --- | --- |
| Approval | Owner-approved on 2026-10-29. Global caps: 1,000 Qloo calls (400 baseline share) and $5.00 model. Per visitor network: 10 searches, 4 scans and 4 investigations. Expiry 2026-11-06T05:00:00Z (judging ends 2026-11-05 23:45 ET). |
| Opened | `CE_APPROVED_QLOO_CALLS=1000 CE_APPROVED_USD=5.00 scripts/public-evaluation-open.sh`, evaluation id `qloo-hackathon-2026` |
| Verified | `verify-production --expect-admissions public --max-qloo 1000 --max-usd 5.00` |

The verification checked the following:

- `/ready` returned 200 with no reasons.
- Ask and brand search are enabled for an anonymous visitor.
- The malformed anonymous probe returned 400. It was admitted and then refused before any call.
- The baseline account limit is 408, which is 8 used plus 400.
- The verdict was `RELEASE_DEGRADED`, only for `VERCEL_PREVIEW_ENV_MISSING:CE_INTERNAL_API_SECRET` and `CI_NOT_RUN`.

## Run A: desktop 1440×900, anonymous judge journey

The hosted acceptance spec (`E2E_PUBLIC_EVALUATION=1`) **passed 3/3 in 7.2 min**, with no page errors, console errors or 5xx responses.

1. Patagonia resolved unambiguously as Qloo entity `DB4CE34E-3A63-4947-946F-9D52502C5762`.
2. The baseline completed in about 33 s.
   - Qloo returned 10 artists, 10 places, 10 films, 10 books and 14 tags.
   - The brand core is Outdoor Clothing.
   - There are 5 directions: Ethical Consumption, folk, Environmental Activism, Natural Fibers and Environmentally Conscious.
3. **Ethical Consumption** was the agent's first direction (Haiku comparative job, about 3.5 min). The result is **Not settled** (`UNCERTAIN_REPRESENTATION_SENSITIVE`).
   - Within {Ethical Consumption, Natural Fibers, Performance Driven}, Ethical Consumption ranked **1 of 3**.
   - Robustness is low, so it is not placed on the fit scale.
   - Qloo's closest matches were Allbirds, Frank And Oak, Greenpeace, New Seasons Market and Asket. The conditioned list was truncated.
4. The contrast question was **"How far can Patagonia extend into luxury jewelry?"** (about 3 min). The result is **Not measured**.
   - The agent built a luxury jewelry panel (Sara Weinstock, Michele Watches, Anil Arjandas Jewels) and one reference territory (ethical fashion).
   - No relative position could be formed, so no class is claimed.
5. HTML (14.9 KB) and PDF (32.2 KB) reports were exported. Save, then reopening from the library, restored both investigations.

## Run B: mobile 390×844 (pre-registered follow-up)

Run B was allowed because Run A's contrast was inconclusive. This run also covers the mobile live journey that Sprint 9L left unverified.

1. Patagonia resolved. The baseline was **reused from storage** (no new Qloo calls), and the page labels it "recorded Qloo evidence".
2. **"How far can Patagonia extend into nightclubs?"** (about 2.3 min): **Not measured**.
   - The agent found venue exemplars (NADIM, So What!) and a brand-conditioned venue list (45 East, Keys On Main, Belly Up Aspen, Bimbo's 365 Club, Chop Suey).
   - It found no consistently shared signals, and no relative position, robustness or class.
3. HTML and PDF were exported, and the research was saved and reopened.

Every product step completed with no page, console or server error. **The test itself is recorded as failed.** At context close, Playwright could not write its trace file, because a concurrent synthetic E2E run on the same machine had cleared the shared `frontend/test-results/` directory. This was a tooling collision, not a product defect. Per the protocol, it was not re-run.

## Cultural Break attempt: outcome

The two pre-registered contrast questions were asked, and both came back **Not measured**:

- luxury jewelry;
- nightclubs.

The stopping rule applies. **This release has not demonstrated a Cultural break in a documented production run.** No rule was changed, and no question was re-run.

What we learned: a free-form single-territory question often builds too small a comparison set to place the territory. The product then says so and offers **"Measure it with a Qloo comparison"**. A direction investigation (Run A step 3) does build a full set.

## Usage

Source: `/ops/status` and `/ops/baselines` at 2026-10-29T07:12Z.

**Qloo**

- 70 dispatches against the durable evaluation ceiling (70 / 1,000).
- The cumulative baseline account is at 15 / 408. This sprint added 7 calls: one fresh scan.

**Haiku**

- 3 investigations, all settled with provider-reported usage (uncertainty `none` × 3).
- **$0.0390 observed.**
- The durable model ledger is at 5 / 500 cents. Each unused reservation was returned after settlement, as designed. Without the release, it would read 150.

**Quotas and state**

- No job is running or queued.
- This test machine's network quota stands at:
  - 2 searches (of 10);
  - 2 scans (of 4);
  - 3 investigations (of 4).

## Not verified

- **Tablet 768×1024 live journey.** Not run. The synthetic E2E covers its layout.
- **The 9M UI changes** (decision-first dossier, home copy, network fit) are verified only by synthetic E2E until they are deployed.
- **GitHub Actions:** `CI_NOT_RUN`. The jobs are not started because of an account billing or spending limit.
- **An LLM-only comparison arm** was not run. We make no comparative performance claim.
