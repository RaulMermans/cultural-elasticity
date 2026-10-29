/**
 * Sprint 9L: tapping a tag drafts a question about it. A draft only: it fills the composer for the user to edit and
 * send, so tapping never starts paid work. Concepts (Qloo tags, taste signals, directions) get the comparative
 * question that can be measured; entities (artists, places, titles, brands) ask what connects them to the brand.
 */
export type TagKind = "concept" | "entity";

export function draftQuestion(brand: string, topic: string, kind: TagKind): string {
  const name = topic.trim().replace(/\s+/gu, " ");
  return kind === "concept" ? `How far can ${brand} extend into ${name}?` : `What connects ${brand} with ${name}?`;
}
