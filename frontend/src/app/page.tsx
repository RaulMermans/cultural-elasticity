import { ResearchApp } from "@/components/research/ResearchApp";
import { recordedBaselines, recordedCatalog } from "@/lib/recorded-research";
import { parseRoute } from "@/lib/research-route";

export const dynamic = "force-dynamic";

/** Brand research is the default view; the Living Atlas is `?mode=atlas`. A recorded deep link renders on first paint. */
export default async function Home({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const raw = await searchParams;
  const route = parseRoute({ get: (name) => { const value = raw[name]; return typeof value === "string" ? value : null; } });
  const initialRecorded = route.research ? recordedBaselines().find((item) => item.key === route.research) ?? null : null;
  return <ResearchApp initialRoute={route} catalog={recordedCatalog()} initialRecorded={initialRecorded} />;
}
