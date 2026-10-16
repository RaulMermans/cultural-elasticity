/**
 * Methodology input contract: a fully assembled, provider-independent evidence bundle for ONE brand
 * and a candidate set of territories.
 *
 *   brand profile (tags, fixed take) ─┐
 *   territory representations ────────┤
 *   exemplar profiles (tags) ─────────┼─→ Cultural Elasticity Methodology v0
 *   candidate panels (one rank call   │
 *     each; one exemplar per territory)
 *   brand-conditioned territory lists ┘
 *
 * Every piece reuses the canonical evidence schemas (../evidence/schema.ts). Nothing here names Qloo.
 * Structural problems are input errors (400). Missing or unverifiable evidence is NOT an error: it is
 * carried through and reported as reduced robustness or evidence quality, never silently filled in.
 */
import { z } from "zod";
import {
  conditionedEntityEvidenceSchema,
  culturalProfileSchema,
  limitationSchema,
  provenanceRefSchema,
  rankingEvidenceSchema,
  type EvidenceIssue,
} from "../evidence/schema.js";

export const METHODOLOGY_INPUT_SCHEMA_VERSION = "ce-methodology-input/0.1";

/**
 * [live 2026-10-16] A 6-option rank call was repeatedly fine; a 10-option call was rate-limited.
 * A panel therefore holds at most six candidates (one exemplar per territory).
 */
export const MAX_PANEL_OPTIONS = 6;

/** [live] Tag profiles are capped at 20 by the harness and tie order depends on `take`: one fixed take. */
export const METHODOLOGY_TAG_TAKE = 20;

const identifier = z.string().trim().min(1);
const text = z.string().trim().min(1);
const provenanceList = z.array(provenanceRefSchema);

export const territoryExemplarSchema = z.strictObject({
  id: identifier,
  label: text,
  type: text,
  /** "primary" is the first-choice exemplar; "alternate" exemplars exist to test substitution. */
  role: z.enum(["primary", "alternate"]),
  note: text.optional(),
  provenance: provenanceList,
});
export type TerritoryExemplar = z.output<typeof territoryExemplarSchema>;

export const territoryRepresentationSchema = z
  .strictObject({
    /** Stable key, e.g. "boutique_hospitality". */
    id: identifier,
    /** Semantic territory, e.g. "Boutique Hospitality". */
    label: text,
    /** Pinned provider concept the territory is anchored to (e.g. a tag). */
    concept: z.strictObject({ id: identifier, label: text, type: text }).optional(),
    /** At least one; two or more are preferred, and one-exemplar territories get INSUFFICIENT robustness. */
    exemplars: z.array(territoryExemplarSchema).min(1),
    rejectedExemplars: z.array(z.strictObject({ label: text, reason: text })).optional(),
    assumptions: z.array(text),
    approximationWarnings: z.array(text),
    provenance: provenanceList,
  })
  .superRefine((territory, ctx) => {
    const primaries = territory.exemplars.filter((exemplar) => exemplar.role === "primary").length;
    if (primaries !== 1) ctx.addIssue({ code: "custom", path: ["exemplars"], message: `exactly one primary exemplar is required (found ${primaries})` });
  });
export type TerritoryRepresentation = z.output<typeof territoryRepresentationSchema>;

export const panelAssignmentSchema = z.strictObject({ territoryId: identifier, exemplarId: identifier });

export const candidatePanelSchema = z
  .strictObject({
    id: identifier,
    /** primary/alternate panels are aggregated; repeat panels only test determinism. */
    purpose: z.enum(["primary", "alternate", "repeat"]),
    repeatOf: identifier.optional(),
    assignments: z.array(panelAssignmentSchema).min(2).max(MAX_PANEL_OPTIONS),
    /** One rank call over exactly the assigned exemplars. Absent = the call failed or was not collected. */
    ranking: rankingEvidenceSchema.optional(),
  })
  .superRefine((panel, ctx) => {
    if ((panel.purpose === "repeat") !== (panel.repeatOf !== undefined)) {
      ctx.addIssue({ code: "custom", path: ["repeatOf"], message: "repeatOf is required for, and only for, repeat panels" });
    }
  });
export type CandidatePanel = z.output<typeof candidatePanelSchema>;

export const methodologyInputSchema = z
  .strictObject({
    schemaVersion: z.literal(METHODOLOGY_INPUT_SCHEMA_VERSION),
    origin: z.enum(["live", "recorded", "synthetic"]),
    brand: culturalProfileSchema,
    tagTake: z.number().int().min(1),
    /** The comparison set. Every panel covers all of it, so v0 supports 2–MAX_PANEL_OPTIONS territories. */
    territories: z.array(territoryRepresentationSchema).min(2).max(MAX_PANEL_OPTIONS),
    exemplarProfiles: z.array(culturalProfileSchema),
    panels: z.array(candidatePanelSchema).min(1),
    conditioned: z.array(conditionedEntityEvidenceSchema),
    limitations: z.array(limitationSchema),
    provenance: provenanceList,
  })
  .superRefine((input, ctx) => refineStructure(input, ctx));
export type MethodologyInput = z.output<typeof methodologyInputSchema>;
export type MethodologyInputRaw = z.input<typeof methodologyInputSchema>;

function refineStructure(input: z.output<typeof methodologyInputSchema>, ctx: z.RefinementCtx): void {
  const issue = (path: (string | number)[], message: string) => ctx.addIssue({ code: "custom", path, message });
  const brandId = input.brand.subject.id;

  // Territories and exemplars: an exemplar may represent exactly one territory.
  const territoryById = new Map<string, TerritoryRepresentation>();
  const owner = new Map<string, string>();
  input.territories.forEach((territory, t) => {
    if (territoryById.has(territory.id)) issue(["territories", t, "id"], `duplicate territory id "${territory.id}"`);
    territoryById.set(territory.id, territory);
    territory.exemplars.forEach((exemplar, e) => {
      if (exemplar.id === brandId) issue(["territories", t, "exemplars", e, "id"], "the brand cannot be its own territory exemplar");
      const existing = owner.get(exemplar.id);
      if (existing !== undefined) issue(["territories", t, "exemplars", e, "id"], `exemplar "${exemplar.id}" already represents territory "${existing}"`);
      owner.set(exemplar.id, territory.id);
    });
  });
  const conceptIds = new Map<string, string>();
  input.territories.forEach((territory, t) => {
    if (territory.concept === undefined) return;
    if (conceptIds.has(territory.concept.id)) issue(["territories", t, "concept", "id"], `concept "${territory.concept.id}" anchors two territories`);
    conceptIds.set(territory.concept.id, territory.id);
  });

  // Fixed take: no profile may be longer than the declared take.
  if (input.brand.signals.length > input.tagTake) issue(["brand", "signals"], `brand profile has more signals than tagTake (${input.tagTake})`);
  const profiled = new Set<string>();
  input.exemplarProfiles.forEach((profile, p) => {
    const id = profile.subject.id;
    if (!owner.has(id)) issue(["exemplarProfiles", p, "subject", "id"], `"${id}" is not a declared exemplar`);
    if (profiled.has(id)) issue(["exemplarProfiles", p, "subject", "id"], `duplicate profile for "${id}"`);
    profiled.add(id);
    if (profile.signals.length > input.tagTake) issue(["exemplarProfiles", p, "signals"], `profile has more signals than tagTake (${input.tagTake})`);
  });

  // Panels: one exemplar per territory, candidates exactly the assigned exemplars, ranked for the brand.
  const panelById = new Map<string, z.output<typeof candidatePanelSchema>>();
  input.panels.forEach((panel, p) => {
    if (panelById.has(panel.id)) issue(["panels", p, "id"], `duplicate panel id "${panel.id}"`);
    panelById.set(panel.id, panel);
    const seenTerritories = new Set<string>();
    panel.assignments.forEach((assignment, a) => {
      if (!territoryById.has(assignment.territoryId)) issue(["panels", p, "assignments", a, "territoryId"], `unknown territory "${assignment.territoryId}"`);
      else if (owner.get(assignment.exemplarId) !== assignment.territoryId) issue(["panels", p, "assignments", a, "exemplarId"], `"${assignment.exemplarId}" is not an exemplar of "${assignment.territoryId}"`);
      if (seenTerritories.has(assignment.territoryId)) issue(["panels", p, "assignments", a], `territory "${assignment.territoryId}" appears twice in one panel`);
      seenTerritories.add(assignment.territoryId);
    });
    if (seenTerritories.size !== territoryById.size) {
      issue(["panels", p, "assignments"], `a panel must assign one exemplar to every territory in the comparison set (${seenTerritories.size} of ${territoryById.size})`);
    }
    if (panel.ranking !== undefined) {
      if (panel.ranking.rankedAgainst !== brandId) issue(["panels", p, "ranking", "rankedAgainst"], "panel candidates must be ranked against the brand subject");
      const assigned = new Set(panel.assignments.map((a) => a.exemplarId));
      const ranked = new Set(panel.ranking.candidates.map((c) => c.id));
      const same = assigned.size === ranked.size && [...assigned].every((id) => ranked.has(id));
      if (!same) issue(["panels", p, "ranking", "candidates"], "ranked candidates must be exactly the panel's assigned exemplars");
    }
  });
  input.panels.forEach((panel, p) => {
    if (panel.repeatOf === undefined) return;
    const original = panelById.get(panel.repeatOf);
    if (original === undefined || original.purpose === "repeat") return issue(["panels", p, "repeatOf"], `repeatOf must name a non-repeat panel`);
    const key = (x: typeof panel) => JSON.stringify([...x.assignments].map((a) => `${a.territoryId}=${a.exemplarId}`).sort());
    if (key(original) !== key(panel)) issue(["panels", p, "assignments"], "a repeat panel must use exactly the assignments of its original");
  });

  // Conditioned evidence: on the brand, one list per territory concept.
  const conditionedTerritories = new Set<string>();
  input.conditioned.forEach((evidence, c) => {
    if (evidence.conditionedOn.id !== brandId) issue(["conditioned", c, "conditionedOn", "id"], "conditioned evidence must be conditioned on the brand subject");
    if (!conceptIds.has(evidence.territory.id)) issue(["conditioned", c, "territory", "id"], `"${evidence.territory.id}" is not the concept of any territory`);
    if (conditionedTerritories.has(evidence.territory.id)) issue(["conditioned", c, "territory", "id"], `duplicate conditioned evidence for "${evidence.territory.id}"`);
    conditionedTerritories.add(evidence.territory.id);
  });
}

export type MethodologyInputParseResult = { ok: true; input: MethodologyInput } | { ok: false; issues: EvidenceIssue[] };

export function parseMethodologyInput(raw: unknown): MethodologyInputParseResult {
  const result = methodologyInputSchema.safeParse(raw);
  if (result.success) return { ok: true, input: result.data };
  return { ok: false, issues: result.error.issues.map((issue) => ({ path: issue.path.map(String).join(".") || "(root)", message: issue.message })) };
}

export class MethodologyInputError extends Error {
  readonly issues: EvidenceIssue[];
  constructor(issues: EvidenceIssue[]) {
    super(`Invalid methodology input: ${issues.map((issue) => `${issue.path}: ${issue.message}`).join("; ")}`);
    this.name = "MethodologyInputError";
    this.issues = issues;
  }
}
