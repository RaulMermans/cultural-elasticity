# Devpost submission: Cultural Elasticity

Ready-to-paste copy for the Qloo Agentic Hackathon 2026 submission form. Every result quoted here comes from a documented live run; the evidence files are linked.

---

## Project title

Cultural Elasticity

## Tagline (one sentence)

Find out how far a brand can stretch into a new territory before it stops feeling like itself, measured with Qloo's cultural evidence rather than guessed by an LLM.

## Short description

Cultural Elasticity is a cultural research tool for brand and insights teams. Enter a brand and Qloo maps its cultural fingerprint. Pick a territory, or ask a question such as "How far can Crocs extend into fine dining?". A Claude agent then plans a bounded investigation with Qloo tools. Deterministic code places the territory against Qloo-validated alternatives as a **Natural fit**, **Credible stretch** or **Cultural break**. When the evidence is too thin to call, it says **Not settled**. Every number traces back to the Qloo call it came from.

## Links

- **Live demo:** https://cultural-elasticity-raulmermans-projects.vercel.app (no sign-up and no key; a free evaluation allowance runs until 6 November 2026)
- **Source code (MIT):** https://github.com/RaulMermans/cultural-elasticity
- **A completed live report:** https://cultural-elasticity-raulmermans-projects.vercel.app/examples/patagonia-2026-10-29.html

## Testing instructions for judges

1. Open the live demo and type any well-known consumer brand (for example Patagonia, Crocs or Liquid Death). Select **Find brand**.
2. Qloo confirms the brand. If the name is ambiguous, choose the right entity. Then select **Start research**.
3. The cultural fingerprint arrives in about a minute and is drawn as a network. Select any direction, then **Investigate**. You can also type your own question into the composer, for example "How far can Patagonia extend into luxury jewelry?".
4. The agent works for 1–4 minutes; its steps appear live. Open the result to see:
   - the reading;
   - the ranking against alternatives;
   - the shared tastes;
   - what is still unknown.
5. Download the **PDF** or **HTML** report, or choose **Save and go back** and reopen it from your library.

The allowance is free, and each visitor gets 4 brand scans and 4 investigations. When it runs out, the product says so and links a previously completed report.

---

## Full description

### The problem

Brands keep entering new territory: footwear into food, outdoor gear into fashion, fashion into hospitality. These moves are usually justified by intuition, a mood board, or an LLM answer that sounds confident and cites nothing. Nobody can check *why* a territory is supposed to fit, how strongly, or compared with what.

### What it does

Cultural Elasticity turns the question "can our brand credibly go there?" into a small, inspectable piece of research:

1. **Cultural fingerprint.** A fixed scan with no model in it asks Qloo what the brand's audience is associated with: artists, places, films, books and taste tags. It proposes directions worth investigating.
2. **Agent investigation.** For the territory you choose, a Claude Haiku agent plans which Qloo lookups to make:
   - it resolves the territory into real Qloo entities and tags;
   - it builds a set of alternatives that Qloo can measure;
   - it collects brand-conditioned rankings.
3. **A reading you can act on.** Tested code, not the model, places the territory within that set. The class comes from fixed rules:

   | Outcome | Rule |
   | --- | --- |
   | Natural fit | Top fifth |
   | Credible stretch | Middle |
   | Cultural break | Bottom fifth |
   | Not settled | Robustness too low, or evidence too thin |

   Each reading also shows how steady the result is, the tastes the territory shares with the brand, Qloo's closest matches, and what evidence is missing.
4. **Keep and share.** You can compare territories for the same brand, export a deterministic HTML or PDF report, and save the research to reopen later.

### Who it is for

- brand strategy teams;
- creative agencies;
- consumer insights teams;
- cultural research consultancies;
- product innovation teams.

These are the audiences we designed for. We have not validated them as paying customers.

### How we use Qloo

Qloo is the measurement, not a decoration:

| Step | Qloo endpoint |
| --- | --- |
| Brand identity | `describe` (ambiguity is surfaced, never guessed) |
| Fingerprint and directions | `recommend`, `entity_tags` |
| Territory representation | Entity and tag search |
| Comparison set | Alternatives that Qloo can resolve |
| Placement | Brand-conditioned `rank` panels; affinities are compared only within one call |

Every Qloo-derived number keeps the correlation ID of its call. If Qloo cannot support a hypothesis, the hypothesis is dropped, not analysed anyway.

### What makes it agentic, and what keeps it honest

- **The model proposes; the runtime decides.** Haiku chooses the next action from the tools that the active skill exposes. The skills cover:
  - resolving the brand;
  - resolving the territory;
  - building a representation;
  - building a comparison set;
  - exploring candidates;
  - analysing.

  Code owns state, budgets, retries, validation, sufficiency and stopping.
- **No invented numbers.** Position, robustness and class are computed by deterministic, tested code. Each claim the model writes passes a claim validator, or a deterministic template replaces it.
- **Bounded and honest probing.** At most 3 empty entity types per concept. A failed or timed-out Qloo call is never treated as evidence. A weak territory panel is never forced through: an honest partial result beats a misleading full one.

### Technical implementation

| Layer | Technology |
| --- | --- |
| Frontend | Next.js 16 and React 19 on Vercel; server-side proxy routes, so the browser never sees a key |
| Backend | Node 22 and Fastify 5 on Railway |
| Data | PostgreSQL: durable brand scans, provider-call reservations, a durable Qloo and model budget ledger, and per-visitor quotas |
| Qloo access | The official `@qloo/qloo-harness` (MCP) on the hackathon host, with calls spaced 7 seconds apart for rate limits |
| Model | Claude Haiku (`claude-haiku-5-5`) as the only production model, with no fallback |
| Tests | More than 900 backend tests, 100+ frontend tests, synthetic browser E2E, and a hosted acceptance suite that drives the real deployment |

### Challenges we ran into

- **Qloo affinities are only comparable within one call.** Brand top-tag affinities saturate (many tied at 1.0), and a tag-only recommend returns flat values. We therefore built placement on brand-conditioned rank panels inside a single call, and the code refuses to compare values across calls.
- **Making an agent useful without letting it make things up.** The answer was a runtime that owns every number and stopping rule. Skills are selected just in time, and a claim validator gates every sentence that reaches the reader.
- **A free public demo with real paid providers.** We built a public evaluation mode:
  - a durable global Qloo and model cap that a restart cannot reset;
  - per-network quotas keyed by a keyed hash of the client address (the address itself never reaches the backend);
  - model reservations returned only when the provider reports usage;
  - an expiry and a kill switch.

### Evidence that it works

All of the following were live on the hosted product, with real Qloo and real Claude calls.

**Crocs** (Sprint 9L, [evidence](https://github.com/RaulMermans/cultural-elasticity/blob/main/docs/sprint-9l/LIVE_RELEASE_EVIDENCE.md)):

- **Fine dining:** Credible stretch, provisional. It sat in the middle of {Colorful, fine dining, Relaxed Living}, with high representation robustness.
- **Fiction:** Inconclusive. Qloo found no shared signal and no valid comparison set.
- **Usage:** 35 Qloo calls and $0.0215 of model usage.

**Patagonia** (Sprint 9M, run as an anonymous visitor exactly as a judge would; [evidence](https://github.com/RaulMermans/cultural-elasticity/blob/main/docs/sprint-9m/LIVE_EVALUATION_EVIDENCE.md)):

- **Ethical Consumption:** ranked 1 of 3 against Natural Fibers and Performance Driven, but robustness was low, so the honest reading is **Not settled** rather than a Natural fit.
- **Luxury jewelry:** RESULT_PENDING.

A real **Cultural break** was pre-registered as a target before these runs, with fixed candidates and a stopping rule; we did not change any rule to produce one. RESULT_PENDING.

### What makes it original

Most "AI brand strategy" tools generate advice. Cultural Elasticity generates **evidence with a confidence level**. It is willing to say "not settled" or "a credible stretch, provisional" when that is what Qloo supports, and it reports results that contradict our own expectations (we expected Crocs → fine dining to break; Qloo said otherwise).

### Limitations

- Outcomes are relative to the comparison set and are not sales forecasts.
- The thresholds (0.8 and 0.2 percentile) are published and provisional.
- Some brands and concepts are not resolvable in Qloo; these are reported as unsupported.
- Investigations take 1–4 minutes because Qloo calls are rate-limited.
- Running jobs live in one backend process. Saved results and budgets are durable; an interrupted run must be asked again.

### What's next

- Calibrating thresholds against known brand extensions.
- Portfolio views across many territories.
- Team workspaces with durable shared research.
- A blinded comparison against LLM-only answers. Its preparation exists in the repo (`pnpm prepare:qloo-value:llm-only`); it has not been run, so we make no comparative claim.

### Built with

Qloo Insights API, `@qloo/qloo-harness`, Claude Haiku (Anthropic API), TypeScript, Next.js, React, Node.js, Fastify, zod, PostgreSQL, Vercel, Railway, Playwright, Vitest.

---

## Media

Curated screenshots from the live product are in [`docs/media/`](../media/):

| File | Shows |
| --- | --- |
| `hero-network.png` | Use as the primary image |

## Video

There is no video. A 75-second shot list and voice-over are in [VIDEO_PLAN.md](VIDEO_PLAN.md), ready to record from the live product.
