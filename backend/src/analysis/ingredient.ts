import type { Ingredient, IngredientStatus } from "@cultural-elasticity/shared";
import type { Limitation, ProvenanceRef } from "../evidence/schema.js";

/** The only way to build an ingredient with a value. */
export function available<T>(value: T, provenance: ProvenanceRef[], limitations: Limitation[] = []): Ingredient<T> {
  return { value, status: "available", provenance, limitations };
}

/** Missing evidence stays `null`. It is never coerced to zero. */
export function withheld<T>(status: Exclude<IngredientStatus, "available">, limitations: Limitation[], provenance: ProvenanceRef[] = []): Ingredient<T> {
  return { value: null, status, provenance, limitations };
}
