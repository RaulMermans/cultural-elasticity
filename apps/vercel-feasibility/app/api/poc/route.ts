import { runHostedPoc } from "../../../lib/poc";

export const runtime = "nodejs";
export const maxDuration = 30;

export async function POST(request: Request) {
  if (request.headers.get("content-length") && Number(request.headers.get("content-length")) > 2_048) {
    return Response.json({ error: "payload too large" }, { status: 413 });
  }
  const started = Date.now();
  const result = await runHostedPoc();
  return Response.json({ ...result, durationMs: Date.now() - started, paidProviders: "disabled" });
}

export function GET() {
  return Response.json({ error: "POST only" }, { status: 405 });
}
