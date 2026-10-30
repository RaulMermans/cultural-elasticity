# Devpost submission: Cultural Elasticity

Ready-to-paste text for the Qloo Agentic Hackathon 2026 submission form. Every result quoted here comes from a documented live run, and the evidence files are linked.

Requirements checked against the official rules on 30 October 2026: a functional demo link, a public repository with a detectable open-source license, and an English text description. A video is optional. The demo must stay free and unrestricted until judging ends (5 November 2026, 11:45 pm ET); the public allowance runs until 6 November 2026, 05:00 UTC.

---

## Project title

Cultural Elasticity

## Tagline

An AI cultural-intelligence researcher that helps brands discover, investigate and evaluate cultural directions using real Qloo evidence.

## Links

- **Live demo:** https://cultural-elasticity-raulmermans-projects.vercel.app (no sign-up and no key)
- **Source code (MIT):** https://github.com/RaulMermans/cultural-elasticity
- **Recorded reports (open instantly, no allowance used):**
  - Crocs: https://cultural-elasticity-raulmermans-projects.vercel.app/examples/crocs-2026-10-29.html
  - Patagonia: https://cultural-elasticity-raulmermans-projects.vercel.app/examples/patagonia-2026-10-29.html

## Testing instructions for judges

1. Open the live demo. Type a well-known consumer brand (for example Crocs, Patagonia, Liquid Death, Aesop or YETI) and select **Find brand**. Qloo confirms the brand; if two entities share the name, choose one.
2. Select **Start research**. The cultural fingerprint arrives in about a minute, drawn as a network.
3. Select a direction and **Investigate**, or type your own question in the composer, for example "How far can Patagonia extend into luxury jewelry?". The agent's steps appear live; it usually takes 1–4 minutes.
4. Read the result from the top: the conclusion, the evidence measurement, the strategic meaning, the comparative result (only when a fair comparison exists) and the technical details with provenance.
5. Download the **PDF** or **HTML** report, or select **Save and go back** and reopen it from your library.

The allowance is free. Each network gets 8 brand research runs, 12 investigations and 20 brand searches until 6 November 2026, 05:00 UTC, and the homepage shows what is left. A question the product cannot run (for example a bridge between a brand and an artist) is answered as *Not run* and uses no investigation allowance. If the allowance or the shared budget is used up, the product says so; the two recorded reports above always open.

---

## Inspiration

Brands keep moving into new cultural territory: footwear into food, outdoor gear into fashion, luxury into hospitality. Those moves are usually justified by intuition, a mood board, or an LLM answer that sounds confident and cites nothing. We wanted a tool that could say *why* a territory fits, how strongly, compared with what, and that would admit when the evidence is not there.

## What it does

Cultural Elasticity is a research tool for **brand strategists, consumer-insights teams, creative agencies and cultural-research consultancies**. (These are the audiences we designed for; we have not validated them as paying customers.)

1. **Discover.** Qloo maps the brand's cultural fingerprint: the artists, places, films, books and taste tags its audience shares. It is drawn as an interactive network of directions, often across domains the brand team would not have looked at, each with the Qloo evidence that put it there.
2. **Investigate.** Pick a direction or ask your own question. A Claude Haiku agent plans a bounded investigation and calls Qloo through typed tools: it represents the territory with real Qloo entities, asks Qloo what it associates with the brand inside that territory, and, when the question calls for it, builds a set of alternatives Qloo can actually measure.
3. **Evaluate.** Tested code, not the model, produces the reading, in two clearly separated parts:
   - an **evidence assessment** of what Qloo showed directly (*Established cultural association*, *Observed association worth examining*, *Limited evidence*, *No support found in the scope tested*, *Not testable as asked*). It is a qualitative assessment, never a score;
   - a **comparative measurement**, only when a valid comparison of at least three Qloo-measurable territories exists. The territory's median brand-conditioned rank places it as a **Natural fit**, **Credible stretch** or **Cultural break**, or **Not settled** when the answer changes with the examples chosen.
4. **Decide what to research next.** A decision card separates the observations from the strategic interpretation (labelled as reasoning, not evidence), states what is missing, and proposes the next research action. The HTML and PDF reports print exactly what the screen shows, and research can be saved and reopened.

## How we use Qloo

Qloo is the measurement, not decoration. Without it there is no result.

| Step | What Qloo provides |
| --- | --- |
| Brand identity | Entity resolution; ambiguity is surfaced, never guessed |
| Cultural fingerprint | Cross-domain taste associations and tags for the brand |
| Territory representation | Real Qloo entities and tags that stand for a territory |
| Direct evidence | Brand-conditioned queries: what Qloo associates with the brand within the territory |
| Comparison | Alternative territories Qloo can resolve, and brand-conditioned rank panels within a single call |

Qloo affinities have no documented cross-call scale, so the code compares values only within one call and keeps every Qloo-derived number's correlation ID. If Qloo cannot support a hypothesis, the hypothesis is dropped, not analysed anyway.

## Why the AI agent is necessary

The right investigation depends on the question. "Fine dining" might be represented by restaurants, chefs or tags; a comparison is only fair against alternatives Qloo can measure for the same entity type; and some questions need direct evidence rather than a ranking. A fixed pipeline cannot know any of that in advance. The agent plans the route step by step: which Qloo lookups to make, how to represent the territory, which references to probe, and when to stop.

What keeps it honest is that **the model proposes and the runtime decides**:

- Haiku chooses only from the tools the active skill exposes (resolve brand, resolve territory, build representation, build comparison set, explore, analyze). Code owns state, budgets, retries, validation, sufficiency and stopping.
- Every number (assessments, positions, robustness, classes) comes from deterministic, tested code. Every sentence the model writes passes a claim validator, or a deterministic template replaces it.
- Probing is bounded (at most 3 empty entity types per concept), a failed or timed-out Qloo call is never evidence, and a weak territory panel is never forced through. An honest partial result beats a misleading full one.

## How we built it

| Layer | Technology |
| --- | --- |
| Frontend | Next.js 16 and React 19 on Vercel; server-side proxy routes, so the browser never sees a key |
| Backend | Node 22, Fastify 5 and zod on Railway |
| Data | PostgreSQL: brand scans, provider-call reservations, Qloo and model budget ledgers, per-network quotas |
| Qloo access | The official `@qloo/qloo-harness` on the hackathon host, with rate-limit spacing |
| Model | Claude Haiku (`claude-haiku-5-5`), the sole production model, with no fallback |
| Tests | 1,064 backend and 119 frontend tests, synthetic browser E2E, offline methodology, agent and query evaluations, and a hosted acceptance suite |

The project was started on 16 October 2026, within the submission period, and built in recorded sprints. Each sprint report keeps what was decided, measured and left unverified.

## Challenges we ran into

- **Qloo values are only comparable within one call.** Brand tag affinities saturate (many tie at 1.0) and tag-only recommendations return flat values. We built placement on brand-conditioned rank panels inside a single call, and the code refuses cross-call comparisons.
- **Usefulness without fabrication.** Early versions answered most real questions with "Not measured" because no fair comparison existed. Instead of loosening the rules, we added a direct evidence assessment, so every completed investigation says what Qloo actually showed, while the comparative class stays reserved for valid comparisons.
- **Semantic validity.** A structurally valid comparison can still be meaningless. In one live run a craft territory was anchored to a product-material tag. We now validate that references are meaningful alternatives before a class is allowed.
- **A free public demo on paid providers.** A durable global Qloo and model ceiling that a restart cannot reset, per-network quotas, reservations released only on reported usage, an expiry and a kill switch. A question the gate cannot run returns its investigation unit.

## Accomplishments that we're proud of

Real results from the hosted product, with live Qloo and Claude calls:

- **Crocs → fine dining: Credible stretch**, ranked 2 of 3 against Colorful and Relaxed Living and steady across example sets. We expected a break; Qloo's evidence did not support that, and the result is reported as found. **Crocs → fiction** could not be measured: there was no valid comparison set, and the report says why. 35 Qloo calls and $0.0215 of model usage ([evidence](https://github.com/RaulMermans/cultural-elasticity/blob/main/docs/sprint-9l/LIVE_RELEASE_EVIDENCE.md)).
- **Patagonia → ethical consumption** ranked 1 of 3 against Natural Fibers and Performance Driven, but with low robustness, so the honest reading is **Not settled**. Luxury jewelry and nightclubs had nothing comparable to measure against ([evidence](https://github.com/RaulMermans/cultural-elasticity/blob/main/docs/sprint-9m/LIVE_EVALUATION_EVIDENCE.md)).
- **Durable recovery:** two real Qloo and Haiku investigations interrupted mid-run (one deliberately killed) resumed from their journal without repeating a paid call ([evidence](https://github.com/RaulMermans/cultural-elasticity/blob/main/docs/sprint-10d/FINAL_RESEARCH_INTELLIGENCE_AND_RELEASE.md)).
- **Honesty under pressure:** we pre-registered an attempt to show a real *Cultural break*. Both contrasts came back unmeasurable, and we did not change a rule or re-run a question to produce one.

## What we learned

Most of the value comes from what the system refuses to say. A cultural-intelligence product is only as trustworthy as its separation between what the data showed, what code computed, and what a model interpreted. Qloo is strongest at cross-domain taste association and within-call ranking; making that legible to a strategist mattered more than adding features.

## Limitations

- Comparative outcomes are relative to the comparison set built for that question. They are not sales forecasts or investment recommendations, and the 0.8 and 0.2 percentile thresholds are published but not calibrated against real brand extensions.
- Qloo coverage decides what can be answered. Many questions end as *Limited evidence* or *Not established comparatively*, and the product says so.
- Research value is still modest. No independent panel has rated the findings, a real Cultural break has not been shown in production, and we have not run a blinded comparison against LLM-only answers, so we make no comparative claim.
- Running investigations live in one backend process. A restart interrupts them; saved research, scans, budgets and quotas are durable.
- Rate-limited Qloo calls make a scan take about a minute and an investigation 1–4 minutes. The public demo shares a capped budget.

## What's next

- Brand-to-entity bridges ("What connects Loewe with BLACKPINK?") as a real, evidence-bounded route.
- Durable agent jobs in production (built and live-tested, not yet enabled).
- Threshold calibration against known brand extensions, and a blinded human and LLM-only comparison.
- Team workspaces with shared research.

## Built with

qloo, qloo-insights-api, anthropic, claude-haiku, typescript, next.js, react, node.js, fastify, zod, postgresql, vercel, railway, playwright, vitest

## Media

Upload in this order. All images show the real product.

| File | Caption |
| --- | --- |
| [`hero-network.png`](../media/hero-network.png) | Patagonia's cultural fingerprint as a research network, from live Qloo evidence |
| [`03-direction-evidence.png`](../media/03-direction-evidence.png) | A direction with the Qloo evidence that put it there |
| [`04-agent-investigating.png`](../media/04-agent-investigating.png) | The agent's real Qloo lookups, live |
| [`05-reading-not-settled.png`](../media/05-reading-not-settled.png) | An honest reading: ranked first, but not settled |
| [`08-exported-report.png`](../media/08-exported-report.png) | The exported Crocs report, with its provenance |
| [`architecture.png`](../media/architecture.png) | The model proposes, code decides, Qloo is the evidence |

The demo storyboard and optional recording plan are in [DEMO_STORYBOARD.md](DEMO_STORYBOARD.md).
