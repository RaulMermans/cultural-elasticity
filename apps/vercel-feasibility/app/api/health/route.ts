export const runtime = "nodejs";
export const maxDuration = 10;

export function GET() {
  return Response.json({
    ok: true,
    product: "cultural-elasticity-feasibility",
    notice: "Private preview. Not the Living Atlas. Paid investigations are disabled.",
    node: process.version,
    hosted: Boolean(process.env.VERCEL),
  });
}
