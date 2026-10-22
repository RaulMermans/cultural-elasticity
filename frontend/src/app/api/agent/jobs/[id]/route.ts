import { readJob } from "@/lib/backend";
import { parseJobEnvelope } from "@/lib/job-envelope";

export const dynamic = "force-dynamic";

export async function GET(request: Request, context: { params: Promise<{ id: string }> }): Promise<Response> {
  const { id } = await context.params;
  const token = request.headers.get("x-job-token") ?? "";
  const upstream = await readJob(id, token);
  if (!upstream) return Response.json({ error: "unavailable", message: "The investigation service is not available right now." }, { status: 503 });
  if (upstream.status === 404) {
    return Response.json({ error: "job_not_found", message: "This investigation is no longer available. You can start a new one." }, { status: 404 });
  }
  const parsed = parseJobEnvelope(upstream.body);
  if (!parsed.ok) return Response.json({ error: "invalid_job_response", message: "The investigation service returned something this atlas cannot show." }, { status: 502 });
  const { accessToken: _token, ...view } = parsed.job;
  return Response.json(view);
}
