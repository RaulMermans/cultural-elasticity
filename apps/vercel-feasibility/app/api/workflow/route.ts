import { getRun, start } from "workflow/api";
import {
  requestSchema,
  refusedRetryWorkflow,
  syntheticInvestigationWorkflow,
} from "../../../workflows/synthetic-investigation";

export const runtime = "nodejs";
export const maxDuration = 30;

const RUN_ID = /^wrun_[A-Z0-9]{8,80}$/;

export async function POST(request: Request) {
  if (request.headers.get("content-length") && Number(request.headers.get("content-length")) > 2_048) {
    return Response.json({ error: "payload too large" }, { status: 413 });
  }
  const body = await request.json().catch(() => ({}));
  const parsed = requestSchema.safeParse(body);
  if (!parsed.success) return Response.json({ error: "invalid request" }, { status: 400 });
  try {
    // Call start() on one workflow function. A union of two workflow types is not a valid start() overload.
    const run =
      parsed.data.mode === "refuse_retry"
        ? await start(refusedRetryWorkflow, [parsed.data])
        : await start(syntheticInvestigationWorkflow, [parsed.data]);
    return Response.json({
      started: true,
      runId: run.runId,
      mode: parsed.data.mode,
      hosted: Boolean(process.env.VERCEL),
      compiler: "workflow/api start()",
      sdk: "workflow@5.2.3",
    });
  } catch (error) {
    return Response.json(
      {
        error: error instanceof Error ? error.message.slice(0, 200) : "workflow failed",
        hosted: Boolean(process.env.VERCEL),
        compiler: "start() refused — Workflow compiler/world unavailable",
        sdk: "workflow@5.2.3",
      },
      { status: 501 },
    );
  }
}

export async function GET(request: Request) {
  const runId = new URL(request.url).searchParams.get("runId");
  if (runId) {
    if (!RUN_ID.test(runId)) return Response.json({ error: "invalid runId" }, { status: 400 });
    try {
      const run = getRun(runId);
      const status = await run.status;
      let returnValue: unknown = null;
      try {
        returnValue = await run.returnValue;
      } catch {
        returnValue = null;
      }
      return Response.json({
        runId,
        status,
        returnValue,
        hosted: Boolean(process.env.VERCEL),
        sdk: "workflow@5.2.3",
      });
    } catch (error) {
      return Response.json(
        {
          runId,
          error: error instanceof Error ? error.message.slice(0, 200) : "inspect failed",
          hosted: Boolean(process.env.VERCEL),
        },
        { status: 404 },
      );
    }
  }
  return Response.json({
    compiler: "workflow/next withWorkflow",
    sdk: "workflow@5.2.3",
    workflows: ["syntheticInvestigationWorkflow", "refusedRetryWorkflow"],
    steps: [
      "validateRequest",
      "syntheticAgentDecision",
      "mockedQlooTool",
      "persistStep",
      "resumeCommitted",
      "uncertainExternal",
    ],
    notice: "GET lists steps. GET ?runId= inspects a run. POST starts a synthetic workflow with no paid providers.",
  });
}
