import { baselineHandoff } from "@/lib/backend";
import { parseJobEnvelope } from "@/lib/job-envelope";
import { operatorOf, visitorIdOf, withVisitor } from "@/lib/job-route";

export const dynamic = "force-dynamic";

export async function POST(request: Request, context: { params: Promise<{ mode: string }> }): Promise<Response> {
  const { mode } = await context.params;
  if (mode !== "preview" && mode !== "jobs") return Response.json({ error: "not_found" }, { status: 404 });
  const token = request.headers.get("x-baseline-token") ?? "";
  if (!token) return Response.json({ error: "baseline_not_found" }, { status: 404 });
  let body: unknown;
  try { body = await request.json(); } catch { return Response.json({ error: "invalid_handoff_request" }, { status: 400 }); }
  const upstream = await baselineHandoff(mode, body, token, visitorIdOf(request), operatorOf(request));
  if (!upstream) return withVisitor(request, Response.json({ error: "unavailable" }, { status: 503 }));
  if (upstream.status >= 400 || mode === "preview") return withVisitor(request, Response.json(upstream.body, { status: upstream.status }));
  const parsed = parseJobEnvelope(upstream.body);
  if (!parsed.ok || !parsed.job.accessToken) return withVisitor(request, Response.json({ error: "invalid_job_response" }, { status: 502 }));
  return withVisitor(request, Response.json(parsed.job, { status: upstream.status }));
}
