import { getAdmissionStatus } from "@/lib/backend";

export const dynamic = "force-dynamic";

/** Public admission view. Never forwards boot id, credentials, or spend. */
export async function GET(): Promise<Response> {
  const view = await getAdmissionStatus();
  return Response.json(view, { headers: { "cache-control": "no-store" } });
}
