/**
 * Brand suggestions while typing. They come only from what this browser already holds: research the user has run
 * (the library) and recorded research. Typing never calls Qloo; a new brand is still found with an explicit search.
 */
export type SuggestionSource<T> = { label: string; detail: string; kind: "library" | "recorded"; value: T; at: number };

const fold = (value: string) => value.normalize("NFD").replace(/\p{M}/gu, "").replace(/[^\p{L}\p{N}]+/gu, " ").trim().toLowerCase();

/** Prefix matches first, then word-start, then anywhere; newest first within each; one entry per brand name. */
export function brandSuggestions<T>(query: string, sources: readonly SuggestionSource<T>[], max = 8): SuggestionSource<T>[] {
  const q = fold(query);
  const rank = (label: string) => {
    const name = fold(label);
    if (!q) return 0;
    if (name.startsWith(q)) return 0;
    if (name.split(" ").some((word) => word.startsWith(q))) return 1;
    return name.includes(q) ? 2 : -1;
  };
  const seen = new Set<string>();
  return sources
    .map((source) => ({ source, score: rank(source.label) }))
    .filter((item) => item.score >= 0)
    .sort((a, b) => a.score - b.score || (a.source.kind === b.source.kind ? 0 : a.source.kind === "library" ? -1 : 1) || b.source.at - a.source.at)
    .map((item) => item.source)
    .filter((source) => { const key = fold(source.label); if (seen.has(key)) return false; seen.add(key); return true; })
    .slice(0, max);
}
