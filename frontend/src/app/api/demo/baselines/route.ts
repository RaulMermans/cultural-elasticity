import { recordedBaselines } from "@/lib/recorded-research";

export const dynamic = "force-static";

/** Serves recorded brand research bundled with the product. It does not call Qloo. */
export function GET(): Response {
  const items = recordedBaselines();
  if (items.length === 0) return Response.json({ error: "invalid_demo", message: "Recorded research could not be shown." }, { status: 500 });
  return Response.json({ kind: "RECORDED_BASELINE_CATALOG", items });
}
