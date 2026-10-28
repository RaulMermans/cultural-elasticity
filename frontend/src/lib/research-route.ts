/**
 * Workspace location in the URL, so back/forward and reloads behave predictably.
 * It names what is shown (a recorded key or "session") and never carries a scan token or any credential.
 */
export type ResearchSection = "overview" | "connections" | "directions" | "summary";
export type Route = {
  mode: "research" | "atlas";
  research: string | null;
  view: ResearchSection;
  /** The research network is the default; the classic section view stays available for the brief and old links. */
  layout: "network" | "tabs";
  item: string | null;
  open: "recorded" | null;
  ask: string | null;
};

const SECTIONS = new Set<ResearchSection>(["overview", "connections", "directions", "summary"]);
const KEY = /^[a-z0-9-]{1,40}$/u;
export const SESSION_RESEARCH = "session";

type Params = { get(name: string): string | null };

export function parseRoute(params: Params): Route {
  const mode = params.get("mode") === "atlas" ? "atlas" : "research";
  const research = params.get("research");
  const view = params.get("view");
  const item = params.get("item");
  const ask = params.get("ask");
  return {
    mode,
    research: mode === "research" && research && KEY.test(research) ? research : null,
    view: view && SECTIONS.has(view as ResearchSection) ? view as ResearchSection : "overview",
    layout: params.get("layout") === "tabs" || (view !== null && SECTIONS.has(view as ResearchSection)) ? "tabs" : "network",
    item: item && item.length <= 300 ? item : null,
    open: mode === "atlas" && params.get("open") === "recorded" ? "recorded" : null,
    ask: mode === "atlas" && ask ? ask.slice(0, 500) : null,
  };
}

export function routeQuery(route: Route): string {
  const params = new URLSearchParams();
  if (route.mode === "atlas") {
    params.set("mode", "atlas");
    if (route.open) params.set("open", route.open);
    if (route.ask) params.set("ask", route.ask);
  } else if (route.research) {
    params.set("research", route.research);
    if (route.view !== "overview") params.set("view", route.view);
    else if (route.layout === "tabs") params.set("layout", "tabs");
    if (route.item) params.set("item", route.item);
  }
  const query = params.toString();
  return query ? `?${query}` : "";
}

export const HOME: Route = { mode: "research", research: null, view: "overview", layout: "network", item: null, open: null, ask: null };

/** Accent- and case-insensitive comparison of a typed name with a recorded brand name. */
export function sameName(a: string, b: string): boolean {
  const fold = (value: string) => value.normalize("NFD").replace(/\p{M}/gu, "").replace(/[^\p{L}\p{N}]+/gu, " ").trim().toLowerCase();
  return fold(a) !== "" && fold(a) === fold(b);
}
