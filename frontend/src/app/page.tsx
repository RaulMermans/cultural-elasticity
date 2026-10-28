import { ResearchApp } from "@/components/research/ResearchApp";
import { parseRoute } from "@/lib/research-route";

export const dynamic = "force-dynamic";

/** Brand research is the default view; the Living Atlas is `?mode=atlas`. */
export default async function Home({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const raw = await searchParams;
  const route = parseRoute({ get: (name) => { const value = raw[name]; return typeof value === "string" ? value : null; } });
  return <ResearchApp initialRoute={route} />;
}
