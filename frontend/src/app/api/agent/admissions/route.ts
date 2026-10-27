import { getAdmissionStatus } from "@/lib/backend";
import { operatorOf } from "@/lib/job-route";

export const dynamic = "force-dynamic";

/** Public admission view. Never forwards boot id, credentials, or spend. */
export async function GET(request: Request): Promise<Response> {
  const view = await getAdmissionStatus(operatorOf(request) !== null);
  return Response.json(view, { headers: { "cache-control": "no-store" } });
}
