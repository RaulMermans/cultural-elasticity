import { start } from "workflow/api";
import { requestSchema, syntheticInvestigationWorkflow } from "../../../workflows/synthetic-investigation";

export const runtime = "nodejs";
export const maxDuration = 30;

export async function POST(request: Request) {
  if (request.headers.get("content-length") && Number(request.headers.get("content-length")) > 2_048) {
    return Response.json({ error: "payload too large" }, { status: 413 });
  }
  const body = await request.json().catch(() => ({}));
  const parsed = requestSchema.safeParse(body);
  if (!parsed.success) return Response.json({ error: "invalid request" }, { status: 400 });
  try {
    const run = await start(syntheticInvestigationWorkflow, [parsed.data]);
    return Response.json({
      started: true,
      runId: run.runId,
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

export function GET() {
  return Response.json({ error: "POST only" }, { status: 405 });
}
