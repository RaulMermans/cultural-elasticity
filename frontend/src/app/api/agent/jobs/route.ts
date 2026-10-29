import { createJob } from "@/lib/backend";
import { parseJobEnvelope } from "@/lib/job-envelope";
import { operatorOf, callerOf, withVisitor } from "@/lib/job-route";

export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<Response> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "invalid_job_request", message: "That question could not be accepted." }, { status: 400 });
  }
  const upstream = await createJob(body, callerOf(request), operatorOf(request));
  if (!upstream) return withVisitor(request, Response.json({ error: "unavailable", message: "The investigation service is not available right now." }, { status: 503 }));
  if (upstream.status >= 400) {
    const message = messageOf(upstream.body) ?? "That question could not be accepted.";
    return withVisitor(request, Response.json({ error: "rejected", message }, { status: upstream.status }));
  }
  const parsed = parseJobEnvelope(upstream.body);
  if (!parsed.ok || !parsed.job.accessToken) {
    return withVisitor(request, Response.json({ error: "invalid_job_response", message: "The investigation service returned something this atlas cannot show." }, { status: 502 }));
  }
  return withVisitor(request, Response.json(parsed.job, { status: 202 }));
}

function messageOf(value: unknown): string | null {
  if (typeof value !== "object" || value === null) return null;
  const message = (value as { message?: unknown }).message;
  return typeof message === "string" && message.length < 240 ? message : null;
}
