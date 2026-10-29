/**
 * Tag facet semantics shared by the brand baseline and the agent's frontier (Sprint 10A moved them here from
 * brand-baseline/research.ts unchanged). The tag URN (`urn:tag:<namespace>:<source>:…`) is authoritative; a tag's name
 * is never read.
 */
import type { FacetRole } from "@cultural-elasticity/shared";
import { tagNamespace } from "./operational-tags.js";

const humanize = (value: string) => value.replaceAll("_", " ").replace(/^\p{L}/u, (letter) => letter.toUpperCase());

/** Facet label from the URN alone (`urn:tag:<namespace>:<source>`), never from the tag's name. */
export function facetLabel(facet: string): string {
  const [namespace = "", source = ""] = facet.split(":");
  if (source === "qloo") return namespace === "keyword" ? "Curated keywords" : humanize(namespace);
  const noun = namespace === "genre" ? "genres" : namespace === "keyword" ? "keywords" : namespace.replaceAll("_", " ");
  return `${humanize(source)} ${noun}`;
}

/**
 * Role of a non-operational tag, by URN facet. Brand classification: `genre:brand` and the curated `industry` and
 * `product_service` concepts described the brand's own category or products in every recorded live profile.
 * Free media keywords are descriptive and noisy. Everything else is a taxonomy-level taste classification.
 */
export function tagRole(facet: string): FacetRole {
  const [namespace, source] = facet.split(":");
  if ((namespace === "genre" && source === "brand") || (source === "qloo" && (namespace === "industry" || namespace === "product_service"))) return "BRAND_CLASSIFICATION";
  if (namespace === "keyword" && source !== "qloo") return "DESCRIPTIVE_KEYWORD";
  return "AUDIENCE_TASTE";
}

/** `namespace:source` of a tag id, or null when the id is not a recognizable tag URN. */
export function tagFacet(tagId: string): string | null {
  const ns = tagNamespace({ id: tagId, category: undefined });
  return ns ? `${ns.namespace}:${ns.source}` : null;
}
