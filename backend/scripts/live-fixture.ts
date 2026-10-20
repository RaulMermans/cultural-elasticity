/**
 * Live fixture format (evals/fixtures/live/). A live fixture is sanitized, normalized evidence captured
 * from the Qloo hackathon API by `pnpm feasibility:qloo -- --write-fixture`. It never contains the API
 * key, request headers, full upstream payloads, addresses, phone numbers or images.
 */
import { fileURLToPath } from "node:url";
import { z } from "zod";
import type { LiveRunResult } from "./feasibility/live.js";
import { QLOO_HACKATHON_ORIGIN } from "../src/qloo/environment.js";
import { QLOO_LIVE_SOURCE } from "../src/qloo/live-adapter.js";

export const LIVE_FIXTURES_DIR = fileURLToPath(new URL("../../evals/fixtures/live/", import.meta.url));
export const LIVE_FIXTURE_FILE = fileURLToPath(new URL("../../evals/fixtures/live/jacquemus-boutique-hospitality.live.json", import.meta.url));

export const liveFixtureSchema = z.strictObject({
  fixtureType: z.literal("live"),
  notice: z.string().startsWith("LIVE"),
  captureDate: z.iso.datetime({ offset: true }),
  apiEnvironment: z.literal(QLOO_HACKATHON_ORIGIN),
  harnessVersion: z.string(),
  provenanceSource: z.literal(QLOO_LIVE_SOURCE),
  sourceOperations: z.array(z.strictObject({ id: z.string(), operation: z.string(), outcome: z.string(), correlationId: z.string().optional() })),
  limitations: z.array(z.string()),
  decision: z.enum(["GO", "CONDITIONAL GO", "NO-GO"]),
  gates: z.array(z.strictObject({ id: z.string(), name: z.string(), tier: z.enum(["CORE", "ENHANCEMENT"]), status: z.string(), observed: z.string() })),
  observations: z.unknown(),
  packet: z.unknown(),
});
export type LiveFixture = z.infer<typeof liveFixtureSchema>;

export function buildLiveFixture(input: { capturedAt: string; apiEnvironment: string; harnessVersion: string; result: LiveRunResult }): LiveFixture {
  const { result } = input;
  return liveFixtureSchema.parse({
    fixtureType: "live",
    notice: "LIVE: sanitized evidence captured from the Qloo hackathon API. Values are query-relative and comparable only within one call (same correlationId).",
    captureDate: input.capturedAt,
    apiEnvironment: input.apiEnvironment,
    harnessVersion: input.harnessVersion,
    provenanceSource: QLOO_LIVE_SOURCE,
    sourceOperations: result.steps.map((s) => ({ id: s.id, operation: s.operation, outcome: s.outcome, ...(s.correlationId && { correlationId: s.correlationId }) })),
    limitations: [
      "Affinity and response popularity have no documented scale or direction; compare only within one correlationId.",
      "compare_audiences, audience_demographics and trends fields are undocumented beyond demographics direction; kept opaque.",
      "Target profile is derived (recurring tags across pinned exemplars), not a Qloo object.",
      "Live values can change between captures; regression checks assert structure, not exact floats.",
    ],
    decision: result.decision,
    gates: result.gates,
    observations: result.observations,
    packet: result.packet,
  });
}
