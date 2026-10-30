# Demo storyboard

How to show Cultural Elasticity to a judge in about three minutes, the fallback when live research is unavailable, and an optional screen-recording plan. Every step uses the real product; nothing here is simulated.

## Primary demonstration: a live brand (about 3–5 minutes)

| # | Do | What the judge should notice |
| --- | --- | --- |
| 1 | Open the [live demo](https://cultural-elasticity-raulmermans-projects.vercel.app). | The question it answers, who it is for, and that results come from Qloo, not a model's opinion |
| 2 | Type a well-known consumer brand (Crocs, Patagonia, Liquid Death, Aesop, YETI). Select **Find brand**. | Qloo confirms the identity first; with two same-named entities you choose, the product never guesses |
| 3 | Select **Start research** and wait about a minute. | The cultural fingerprint drawn as a network, with directions across domains and *why each is here*, with its Qloo evidence |
| 4 | Select a direction, then **Investigate** (or type "How far can ‹brand› extend into ‹territory›?" in the composer). | The agent's real steps stream in: which Qloo lookups it chose and why; 1–4 minutes |
| 5 | Read the result from the top. | Conclusion first (an evidence assessment, not a score), then the evidence measurement, the strategic meaning (labelled as reasoning), the comparative result *only if* a fair comparison existed, and the technical details with provenance |
| 6 | Download the **PDF** or **HTML** report, then **Save and go back** and reopen it from the library. | The export says the same thing as the screen; saved research reopens with no new Qloo call |
| 7 | Optional: ask "What connects ‹brand› with ‹an artist›?" | An honest *Not run*: bridges are not built yet, and the answer states that no investigation credit was used |

Say plainly what the run produced. If the result is *Limited evidence* or *Not established comparatively*, show that as the feature it is: the product refuses to invent a fit.

## Fallback: recorded reports (no allowance, no wait)

Use these when the public allowance for the network is used up, a live run is slow, or the judge only has a minute. Both were exported from live hosted runs on 29 October 2026 with real Qloo and Claude calls; opening them starts nothing.

1. [**Crocs**](https://cultural-elasticity-raulmermans-projects.vercel.app/examples/crocs-2026-10-29.html), the primary recorded example: fine dining is a **credible stretch**, ranked 2 of 3 against Colorful and Relaxed Living and steady across example sets, next to fiction, which could not be measured, with the reason. 35 Qloo calls and $0.0215 of model usage ([evidence](../sprint-9l/LIVE_RELEASE_EVIDENCE.md)).
2. [**Patagonia**](https://cultural-elasticity-raulmermans-projects.vercel.app/examples/patagonia-2026-10-29.html): ethical consumption ranked 1 of 3, but with low robustness, so it is reported as *Not settled*; and two territories with nothing comparable to measure against ([evidence](../sprint-9m/LIVE_EVALUATION_EVIDENCE.md)).

They are linked from the homepage under "Want to see finished results first?". They predate the conclusion-first layout, so their wording differs slightly from today's workspace; their numbers do not change.

## Presentation assets

| Asset | File | Source |
| --- | --- | --- |
| Hero: the cultural network | [`media/hero-network.png`](../media/hero-network.png) | Live Patagonia research, hosted product, 29 Oct 2026 |
| Brand confirmed by Qloo | [`media/02-brand-resolved.png`](../media/02-brand-resolved.png) | Same live session |
| Cultural fingerprint: a direction and its evidence | [`media/03-direction-evidence.png`](../media/03-direction-evidence.png) | Same live session |
| Agent investigating | [`media/04-agent-investigating.png`](../media/04-agent-investigating.png) | Same live session |
| Research result | [`media/05-reading-not-settled.png`](../media/05-reading-not-settled.png) | Same live session; the result layout before Sprint 12's conclusion-first ordering |
| Mobile reading | [`media/06-mobile-reading.png`](../media/06-mobile-reading.png) | Same live session |
| Saved library | [`media/07-saved-library.png`](../media/07-saved-library.png) | Same live session |
| Exported report | [`media/08-exported-report.png`](../media/08-exported-report.png) | The recorded Crocs report as served in production, captured 30 Oct 2026 |
| Architecture | [`media/architecture.png`](../media/architecture.png) | Drawn from the code ([source](../media/architecture.source.html)) |

A screenshot of today's conclusion-first result with real evidence needs a fresh live run; see the budget request in [FINAL_RELEASE_REVIEW.md](FINAL_RELEASE_REVIEW.md). Synthetic test screens are never used as product images.

## Optional screen recording (75 seconds)

Optional under the rules. Record only from a real run, or from saved research reopened in the library (no new provider call). Mark each cut over a wait with a small "time-lapse" caption, and never simulate an agent step.

| Time | Screen | Voice-over |
| --- | --- | --- |
| 0–8 s | Homepage headline | "Brand teams keep looking for their next cultural territory. Usually they guess, or ask a chatbot that cites nothing." |
| 8–20 s | Brand found, **Start research**, cut (time-lapse) to the network | "Cultural Elasticity starts from Qloo: what the brand's audience already shares, across music, places, film, books and taste." |
| 20–30 s | A direction's dossier and its Qloo evidence | "Some directions are expected, some are not. Each one shows the Qloo evidence that put it there." |
| 30–45 s | **Investigate**, 3 s of live steps, time-lapse cut | "An AI agent plans the research: which Qloo lookups to make, and which alternatives Qloo can actually measure." |
| 45–62 s | The result from the conclusion down | "Tested code, not the model, decides what the evidence shows and where the territory sits. When the evidence is thin, it says so." |
| 62–70 s | The PDF report for 2 s | "The report says exactly what the screen says, with its provenance." |
| 70–75 s | Homepage with the URL | "Discover the unexpected. Validate it with cultural intelligence." |

Read the voice-over against the run actually filmed; never describe a class the run did not produce. Export 1080p H.264 under 100 MB, upload unlisted to YouTube or Vimeo, and check the full video for tokens, emails or notifications before linking it.
