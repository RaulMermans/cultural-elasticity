# Demo video plan (75 seconds)

**Status:** not recorded. This is a ready-to-record plan, optional for the submission.

**Rules for the recording:**

- Use genuine screen recordings of the live product only.
- Shorten waits with cuts, and label each cut "time-lapse".
- Never simulate an agent step.
- Keep no credentials, browser profile or other tabs on screen.

## Footage source (Sprint 9O)

Record from a **completed, verified run**, not a run made only for filming.

The Sprint 9O desktop acceptance run (pre-registered case `9o-c4-holdout-discovery`) can be recorded in the same browser session with `E2E_VIDEO=1`. Playwright then keeps a genuine 1440×900 recording of the real hosted product next to the run's evidence. That footage is the raw material.

If it is unusable, record by hand from the saved research in the library. Reopening saved research makes no new provider call.

| | |
| --- | --- |
| Browser | Chrome, window 1440×900, zoom 100%, no extensions bar |
| URL | https://cultural-elasticity-raulmermans-projects.vercel.app |
| Capture | The Playwright video (`E2E_VIDEO=1`), or macOS `Shift-Cmd-5` / QuickTime at 60 fps |
| Spend | None beyond the acceptance run itself |

## Shot list and voice-over

| Time | Beat | Screen | Voice-over |
| --- | --- | --- | --- |
| 0–8 s | The strategist's problem | Home page headline | "Brand teams keep looking for their next territory. Usually they guess, or ask a chatbot that cites nothing." |
| 8–20 s | A real Qloo fingerprint | Brand typed, **Find brand**, Qloo confirms, **Start research**. Cut (time-lapse) to the network. | "Cultural Elasticity starts from Qloo. It maps what the brand's audience already shares: artists, places, films, books and tastes." |
| 20–30 s | An interesting direction | Select the direction that was investigated; show its dossier and Qloo evidence chips. | "Some directions are expected. Some are not. Each one comes with the Qloo evidence that put it there." |
| 30–45 s | Real agent research | **Investigate**; show the live agent steps for 3 s, then a "time-lapse" cut. | "An AI agent plans the research: it finds Qloo entities for the territory and alternatives Qloo can measure." |
| 45–58 s | A defensible finding and its uncertainty | The reading: outcome, steadiness, "What we don't know yet". | "Tested code, not the model, places it. When Qloo's evidence is thin, it says so." |
| 58–68 s | The decision card | Scroll the decision card: finding, why it matters, uncertainty, next actions. Show the PDF for 2 s. | "Every reading ends in a decision: what was found, what is uncertain, and what to research next." |
| 68–75 s | The product link | Home page with the URL visible. | "Discover the unexpected. Validate it with cultural intelligence. Try it live." |

Read the voice-over against the run actually filmed. If the reading was "Not settled", say so on screen. Never describe a class the run did not produce.

## Editing

- **Cuts.** Mark each cut over a waiting period with a small "time-lapse" caption in the bottom-left corner.
- **Captions.** Keep them at 28 px or larger, in high-contrast text. Burn in subtitles of the voice-over.
- **Music.** Use only royalty-free, properly licensed tracks, quiet under the voice. The alternative is no music.
- **Export.** 1080p MP4 (H.264), under 100 MB, uploaded to YouTube or Vimeo as unlisted, then linked on Devpost.
- **Final check.** Before uploading, watch the whole video once at full screen for any token, email or notification.
