import { brandBaselineFetch } from "@/lib/backend";
import { operatorOf, callerOf, withVisitor } from "@/lib/job-route";

export const dynamic = "force-dynamic";

function backendPath(parts: string[]): string | null {
  if (parts.length === 1 && (parts[0] === "status" || parts[0] === "resolve" || parts[0] === "baselines")) return `/api/brands/${parts[0]}`;
  if (parts[0] === "baselines" && parts.length >= 2 && parts.length <= 3 && /^[0-9a-f-]{36}$/u.test(parts[1] ?? "") && (parts.length === 2 || parts[2] === "territories" || parts[2] === "evidence")) return `/api/brands/${parts.join("/")}`;
  return null;
}

async function proxy(request: Request, context: { params: Promise<{ path: string[] }> }, method: "GET" | "POST"): Promise<Response> {
  const path = backendPath((await context.params).path);
  if (!path) return Response.json({ error: "not_found" }, { status: 404 });
  const token = request.headers.get("x-baseline-token");
  const headers = new Headers();
  if (token) headers.set("x-baseline-token", token);
  let body: string | undefined;
  if (method === "POST") {
    body = await request.text();
    if (body.length > 4096) return Response.json({ error: "request_too_large" }, { status: 413 });
    headers.set("content-type", "application/json");
  }
  const upstream = await brandBaselineFetch(path, { method, headers, ...(body !== undefined ? { body } : {}) }, callerOf(request), operatorOf(request));
  if (!upstream) return withVisitor(request, Response.json({ error: "baseline_unavailable" }, { status: 503 }));
  return withVisitor(request, Response.json(upstream.body, { status: upstream.status }));
}

export const GET = (request: Request, context: { params: Promise<{ path: string[] }> }) => proxy(request, context, "GET");
export const POST = (request: Request, context: { params: Promise<{ path: string[] }> }) => proxy(request, context, "POST");
