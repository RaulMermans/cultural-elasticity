import { comparativeReport } from "@/lib/backend";
import { visitorIdOf, withVisitor } from "@/lib/job-route";

export const dynamic = "force-dynamic";

/** The server-validated comparative report for a comparison job. Never computed in the browser. */
export async function GET(request: Request, context: { params: Promise<{ id: string }> }): Promise<Response> {
  const { id } = await context.params;
  const token = request.headers.get("x-job-token") ?? "";
  if (!token) return Response.json({ error: "job_not_found" }, { status: 404 });
  const upstream = await comparativeReport(id, token, visitorIdOf(request));
  if (!upstream) return withVisitor(request, Response.json({ error: "unavailable" }, { status: 503 }));
  return withVisitor(request, Response.json(upstream.body, { status: upstream.status }));
}
