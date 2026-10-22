/**
 * Query-layer boundary contracts (zod). The interpreter model proposes a QueryProposal; nothing in it is trusted
 * until the deterministic gate (gate.ts) has checked it. The proposal has no field for tools, budgets, evidence,
 * entity ids or run ids: whatever a query says, the model cannot express them, and a proposal carrying any extra
 * field is rejected by the strict schema.
 */
import { QUERY_INTENTS } from "@cultural-elasticity/shared";
import { z } from "zod";
import { AGENT_INTENTS } from "../contracts.js";

const text = (max: number) => z.string().trim().min(1).max(max);

/** Lineage handle shown to the interpreter: L0 is the investigation the user is looking at, L1 its parent, ... */
export const contextRefSchema = z.string().regex(/^L\d{1,2}$/u);

export const queryProposalSchema = z.strictObject({
  primaryIntent: z.enum(QUERY_INTENTS),
  secondaryIntents: z.array(z.enum(QUERY_INTENTS)).max(4),
  /** Brands named in THIS query, as written. */
  brandsNamed: z.array(text(200)).max(4),
  /** Territories the operation targets: named in the query, or (fromContext) taken from the investigation context. */
  territories: z.array(z.strictObject({ name: text(120), fromContext: z.boolean() })).max(8),
  /** The context node the query refers to, if any (L0 = current). */
  contextRef: contextRefSchema.nullable(),
  /** A territory key of a context node the query refers to (refinement source, or the place to return to). */
  contextTerritoryKey: text(80).nullable(),
  constraints: z.array(text(200)).max(8),
  unresolvedReferences: z.array(text(200)).max(6),
  systemDirectives: z.array(text(300)).max(6),
  confidence: z.enum(["HIGH", "MEDIUM", "LOW"]),
  clarificationQuestion: text(300).nullable(),
});
export type QueryProposal = z.output<typeof queryProposalSchema>;

/** The same schema as JSON Schema, for the model's structured output (kept in sync by a unit test). */
export const QUERY_PROPOSAL_JSON_SCHEMA = {
  type: "object",
  properties: {
    primaryIntent: { type: "string", enum: [...QUERY_INTENTS] },
    secondaryIntents: { type: "array", items: { type: "string", enum: [...QUERY_INTENTS] } },
    brandsNamed: { type: "array", items: { type: "string" } },
    territories: {
      type: "array",
      items: { type: "object", properties: { name: { type: "string" }, fromContext: { type: "boolean" } }, required: ["name", "fromContext"], additionalProperties: false },
    },
    contextRef: { anyOf: [{ type: "string" }, { type: "null" }] },
    contextTerritoryKey: { anyOf: [{ type: "string" }, { type: "null" }] },
    constraints: { type: "array", items: { type: "string" } },
    unresolvedReferences: { type: "array", items: { type: "string" } },
    systemDirectives: { type: "array", items: { type: "string" } },
    confidence: { type: "string", enum: ["HIGH", "MEDIUM", "LOW"] },
    clarificationQuestion: { anyOf: [{ type: "string" }, { type: "null" }] },
  },
  required: ["primaryIntent", "secondaryIntents", "brandsNamed", "territories", "contextRef", "contextTerritoryKey", "constraints", "unresolvedReferences", "systemDirectives", "confidence", "clarificationQuestion"],
  additionalProperties: false,
} as const;

// ---- API bodies ----

const contextBody = z.strictObject({ runId: z.string().uuid(), selectedTerritoryKey: text(80).optional() });

/** Structured fields the caller may fix explicitly. They always win over the model and a contradiction is never merged. */
const explicitFields = {
  brand: text(200).optional(),
  intent: z.enum(AGENT_INTENTS).optional(),
  territories: z.array(text(200)).max(6).optional(),
};

export const queryBody = z.strictObject({
  query: text(2_000),
  ...explicitFields,
  context: contextBody.optional(),
  /** Development only: "baseline" uses the structural interpreter and the baseline reference policy. */
  model: z.enum(["auto", "baseline"]).optional(),
});
export type QueryBody = z.output<typeof queryBody>;

/** Executes a query interpreted earlier (dry run, or a supported alternative) without interpreting it again. */
export const confirmBody = z.strictObject({ confirmQueryId: z.string().uuid(), model: z.enum(["auto", "baseline"]).optional() });

export type ExplicitFields = { brand?: string; intent?: (typeof AGENT_INTENTS)[number]; territories?: string[] };
