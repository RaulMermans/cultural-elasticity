/**
 * Deterministic query execution gate. Turns a model's QueryProposal into a QueryInterpretation with a disposition,
 * and, only when it is EXECUTABLE, into the exact runtime handoff. No model can bypass it.
 *
 * It checks, in order: out-of-scope and deferred operations, context requirements, explicit-field conflicts,
 * contextual operations (refine / switch / return), brand requirements, open references, territory cardinality
 * (the router's own interpretationSchema and resolveInterpretation), lineage depth, system directives and
 * secondary objectives. Every refusal, deferral and clarification carries a reason code.
 *
 * It has no word lists, brand lists or category lists: it reads only the proposal's typed fields, the caller's
 * structured fields and the server's own run state. Matching is referential (keys and labels the context holds).
 */
import { CONTEXTUAL_QUERY_INTENTS, DEFERRED_QUERY_INTENTS, EXECUTABLE_QUERY_INTENTS, QUERY_SCHEMA_VERSION, type InvestigationLink, type InvestigationOperation, type QueryDisposition, type QueryHandoff, type QueryIntent, type QueryInterpretation, type QueryReasonCode } from "@cultural-elasticity/shared";
import type { AgentIntent, AgentRequest, Interpretation } from "../contracts.js";
import { interpretationSchema } from "../contracts.js";
import { resolveInterpretation } from "../router.js";
import { slugify, type AgentRunState } from "../state.js";
import { MAX_LINEAGE_DEPTH, type ResolvedContext } from "./context.js";
import type { ExplicitFields, QueryProposal } from "./contracts.js";
import type { InterpreterInfo } from "./interpreter.js";

export type GateInput = {
  query: string;
  explicit: ExplicitFields;
  proposal: QueryProposal;
  context: ResolvedContext | null;
  interpreter: InterpreterInfo;
};

export type ExecutionPlan = { handoff: QueryHandoff; request: AgentRequest; interpretation: Interpretation; link: Omit<InvestigationLink, "queryId"> };

export type GateResult = {
  interpretation: QueryInterpretation;
  /** Set only for EXECUTABLE. */
  plan: ExecutionPlan | null;
  /** A smaller supported task (never executed without confirmation, never equivalent). */
  alternative: { description: string; plan: ExecutionPlan } | null;
  /** Set only for NAVIGATION (return to an investigation this process still holds). */
  navigation: { runId: string } | null;
};

const EXECUTABLE = new Set<string>(EXECUTABLE_QUERY_INTENTS);
const CONTEXTUAL = new Set<string>(CONTEXTUAL_QUERY_INTENTS);
const DEFERRED = new Set<string>(DEFERRED_QUERY_INTENTS);
const MAX_TERRITORIES = 6;

const norm = (s: string) => s.normalize("NFKC").trim().replace(/\s+/gu, " ").toLowerCase();
const same = (a: string, b: string) => norm(a) === norm(b);
const dedupe = (items: string[]) => items.filter((x, i) => items.findIndex((y) => same(x, y)) === i);

export function runGate(input: GateInput): GateResult {
  const { proposal: p, explicit, context } = input;
  const reasons: QueryReasonCode[] = [];
  const warnings: string[] = [];
  const unsupported: string[] = [];
  const reason = (code: string, detail: string) => reasons.push({ code, detail });

  const current = context?.nodes[0]?.state ?? null;
  const contextLabels = new Map<string, string>();
  for (const { state } of context?.nodes ?? []) for (const t of state.territories) contextLabels.set(norm(t.label), t.label);

  // ---- Fields: explicit structured fields win; the model fills only what they leave open. ----
  const brandsNamed = dedupe(p.brandsNamed);
  const conflicts: string[] = [];
  const proposedTerritories = dedupeBy(p.territories, (t) => norm(t.name)).map((t) => {
    if (!t.fromContext) return { name: t.name, source: "EXPLICIT" as const };
    const known = contextLabels.get(norm(t.name));
    if (known) return { name: known, source: "INHERITED" as const };
    warnings.push(`CONTEXT_TERRITORY_NOT_FOUND: "${t.name}" is not a territory of the context; treated as named by the user`);
    return { name: t.name, source: "EXPLICIT" as const };
  });
  let territories = proposedTerritories;
  if (explicit.territories) {
    territories = explicit.territories.map((name) => ({ name, source: "EXPLICIT" as const }));
    const model = proposedTerritories.map((t) => norm(t.name)).sort();
    const fixed = explicit.territories.map(norm).sort();
    if (model.length > 0 && (model.length !== fixed.length || model.some((t, i) => t !== fixed[i]))) conflicts.push(`the territories field fixes [${explicit.territories.join(", ")}] but the message asks about [${proposedTerritories.map((t) => t.name).join(", ")}]`);
  }
  if (explicit.brand && brandsNamed.length > 0 && !brandsNamed.some((b) => same(b, explicit.brand!))) conflicts.push(`the brand field fixes "${explicit.brand}" but the message names ${brandsNamed.map((b) => `"${b}"`).join(", ")}`);

  const inheritedBrand = current?.brand.entity ? { id: current.brand.entity.id, label: current.brand.entity.label } : null;
  let brand: QueryInterpretation["brand"];
  if (explicit.brand) brand = { name: explicit.brand, source: "EXPLICIT" };
  else if (brandsNamed.length === 1) brand = { name: brandsNamed[0]!, source: "EXPLICIT" };
  else if (brandsNamed.length === 0 && inheritedBrand) brand = { name: inheritedBrand.label, source: "INHERITED", inheritedId: inheritedBrand.id };
  else brand = { name: null, source: "UNRESOLVED" };

  if (p.systemDirectives.length > 0) {
    unsupported.push("SYSTEM_DIRECTIVE");
    reason("SYSTEM_DIRECTIVE_REFUSED", `instructions aimed at the system are not authorized by a query: ${p.systemDirectives.map((d) => `"${d}"`).join("; ")}`);
  }

  const secondaries = dedupe(p.secondaryIntents).filter((i) => i !== p.primaryIntent) as QueryIntent[];
  const finish = (disposition: QueryDisposition, extra: Partial<Pick<GateResult, "plan" | "alternative" | "navigation">> = {}, clarificationQuestion?: string): GateResult => ({
    interpretation: {
      schemaVersion: QUERY_SCHEMA_VERSION,
      rawQuery: input.query,
      primaryIntent: p.primaryIntent,
      secondaryIntents: secondaries,
      brand,
      brandsNamed,
      territories,
      references: {
        ...(current && { parentRunId: current.runId }),
        ...((extra.plan?.link.selectedTerritoryKey ?? context?.selectedTerritoryKey) && { selectedTerritoryKey: extra.plan?.link.selectedTerritoryKey ?? context?.selectedTerritoryKey ?? undefined }),
        ...(extra.navigation && { returnToRunId: extra.navigation.runId }),
      },
      constraints: p.constraints,
      unresolvedReferences: p.unresolvedReferences,
      systemDirectives: p.systemDirectives,
      confidence: p.confidence,
      disposition,
      ...(clarificationQuestion && { clarificationQuestion }),
      unsupportedCapabilities: [...new Set(unsupported)],
      interpretationWarnings: [...new Set(warnings)],
      reasonCodes: reasons,
      interpreter: input.interpreter,
    },
    plan: extra.plan ?? null,
    alternative: extra.alternative ?? null,
    navigation: extra.navigation ?? null,
  });
  // A message carrying system directives is never answered with a benign clarification question: it is refused.
  const directive = p.systemDirectives.length > 0;
  const clarify = (code: string, detail: string, question: string) => {
    reason(code, detail);
    return directive ? finish("UNSUPPORTED") : finish("NEEDS_CLARIFICATION", {}, question);
  };
  const modelQuestion = p.clarificationQuestion ?? undefined;

  // ---- 1. Out of scope and deferred (recognized, not implemented) operations. ----
  if (p.primaryIntent === "out_of_scope") {
    unsupported.push("out_of_scope");
    reason("OUT_OF_SCOPE", "the message is not a cultural brand-extension question this system investigates");
    return finish("UNSUPPORTED");
  }
  for (const s of secondaries) if (DEFERRED.has(s)) unsupported.push(s);
  if (DEFERRED.has(p.primaryIntent)) {
    unsupported.push(p.primaryIntent);
    reason("UNSUPPORTED_OPERATION", `${p.primaryIntent} is recognized but not implemented; the runtime investigates one brand at a time and never compares separate Qloo calls numerically`);
    const alt = deferredAlternative(p.primaryIntent, brandsNamed, explicit, territories);
    const altPlan = alt ? plan(alt.intent, { name: alt.brand, source: "EXPLICIT" }, alt.territories.map((name) => ({ name })), null, "NEW_INVESTIGATION", input, null) : null;
    return finish("UNSUPPORTED", { alternative: alt && altPlan?.ok ? { description: alt.description, plan: altPlan.plan } : null });
  }

  // ---- 2. Context requirements. ----
  const refersToContext = CONTEXTUAL.has(p.primaryIntent) || p.contextRef !== null || p.contextTerritoryKey !== null || p.territories.some((t) => t.fromContext);
  if (refersToContext && !context) {
    if (p.primaryIntent === "clarify_reference") return clarify("CLARIFICATION_REQUIRED", "the message refers to something that is not identified", modelQuestion ?? "Which brand and territory do you mean?");
    reason("NO_CONTEXT_PROVIDED", "the message refers to an earlier investigation, but no investigation context was sent");
    return finish("CONTEXT_UNAVAILABLE");
  }
  if (p.contextRef && context && !context.nodes.some((n) => n.ref === p.contextRef)) warnings.push(`CONTEXT_REF_UNKNOWN: ${p.contextRef} is not in the held lineage`);

  if (conflicts.length > 0) return clarify("EXPLICIT_FIELD_CONFLICT", conflicts.join("; "), `The message and the structured fields disagree (${conflicts.join("; ")}). Which should be investigated?`);

  if (p.primaryIntent === "clarify_reference") return clarify("CLARIFICATION_REQUIRED", `unresolved: ${p.unresolvedReferences.join("; ") || "the referent of the message"}`, modelQuestion ?? "Which territory or investigation do you mean?");

  // ---- 3. Return to an earlier investigation: navigation, never a new run. ----
  if (p.primaryIntent === "return_to_parent") {
    if (directive) {
      reason("DIRECTIVE_BLOCKS_NAVIGATION", "a return that carries system directives is refused rather than performed");
      return finish("UNSUPPORTED");
    }
    const target = returnTarget(p, context!, territories);
    if (target.ok) return finish("NAVIGATION", { navigation: { runId: target.runId } });
    if (target.code === "ANCESTOR_UNAVAILABLE") {
      reason(target.code, target.detail);
      return finish("CONTEXT_UNAVAILABLE");
    }
    return clarify(target.code, target.detail, modelQuestion ?? "Which earlier investigation should we return to?");
  }

  // ---- 4. Map the operation onto an executable capability. ----
  const capability = capabilityFor(p.primaryIntent, territories.length);
  if (!capability.ok) return clarify(capability.code, capability.detail, modelQuestion ?? capability.question);
  if (explicit.intent && explicit.intent !== capability.intent) return clarify("EXPLICIT_FIELD_CONFLICT", `the intent field fixes ${explicit.intent} but the message asks for ${p.primaryIntent}`, `The intent field says ${explicit.intent}, but the message reads as ${p.primaryIntent}. Which should be investigated?`);

  // ---- 5. Brand. ----
  if (brandsNamed.length > 1) return clarify("BRAND_AMBIGUOUS", `the message names several brands (${brandsNamed.join(", ")}) for a single-brand operation`, modelQuestion ?? `Which brand should be investigated: ${brandsNamed.join(" or ")}?`);
  if (brand.source === "UNRESOLVED") return clarify("BRAND_MISSING", current ? "the context run has no resolved brand to inherit and the message names none" : "no brand is named", modelQuestion ?? "Which brand should be investigated?");

  // ---- 6. Open references and low confidence (before any Qloo call). ----
  if (p.unresolvedReferences.length > 0) return clarify("CLARIFICATION_REQUIRED", `unresolved: ${p.unresolvedReferences.join("; ")}`, modelQuestion ?? `What do you mean by ${p.unresolvedReferences.map((r) => `"${r}"`).join(", ")}?`);
  if (p.confidence === "LOW") return clarify("LOW_CONFIDENCE", "the interpreter could not identify the operation with confidence", modelQuestion ?? "Could you rephrase what you want investigated?");

  // ---- 7. Lineage bound. ----
  if (context && context.nodes.length >= MAX_LINEAGE_DEPTH) {
    reason("LINEAGE_LIMIT", `follow-up chains are limited to ${MAX_LINEAGE_DEPTH} investigations; start a new investigation`);
    return finish("UNSUPPORTED");
  }

  // ---- 8. The plan (cardinality, schema and explicit fields re-checked by the router itself). ----
  const operation = operationFor(p.primaryIntent, context, brand);
  const selected = selectedTerritory(p, context, warnings);
  const built = plan(capability.intent, brand, territories, selected, operation, input, current);
  if (!built.ok) return clarify(built.code, built.detail, built.question);
  if (p.constraints.length > 0) warnings.push("CONSTRAINTS_NOT_ENFORCED_BY_METHODOLOGY: the constraints are passed to the investigation with the query and recorded; the methodology does not filter evidence by them");
  if (input.interpreter.kind === "structural") warnings.push("TEXT_NOT_INTERPRETED: no model is configured; only the structured fields and context were read");

  // ---- 9. Directives and secondary objectives: a single supported core is never reported as the whole request. ----
  for (const s of secondaries) {
    if (DEFERRED.has(s)) reason("UNSUPPORTED_SECONDARY_OBJECTIVE", `${s} is recognized but not implemented`);
    else if (s === "out_of_scope") reason("UNSUPPORTED_SECONDARY_OBJECTIVE", "part of the message is outside this system's scope");
    else if (EXECUTABLE.has(s) || CONTEXTUAL.has(s)) {
      if (s === capability.intent) continue;
      unsupported.push(`compound:${s}`);
      reason("COMPOUND_NOT_EXECUTED", `${s} would be a second investigation; one query runs one investigation`);
    }
  }
  const partial = reasons.some((r) => r.code === "SYSTEM_DIRECTIVE_REFUSED" || r.code === "UNSUPPORTED_SECONDARY_OBJECTIVE" || r.code === "COMPOUND_NOT_EXECUTED");
  if (partial) return finish("PARTIALLY_SUPPORTED", { alternative: { description: `Run only the supported part: ${describe(built.plan.handoff)}. The rest of the request is not performed.`, plan: built.plan } });
  return finish("EXECUTABLE", { plan: built.plan });
}

function dedupeBy<T>(items: T[], key: (t: T) => string): T[] {
  return items.filter((x, i) => items.findIndex((y) => key(y) === key(x)) === i);
}

function describe(h: QueryHandoff): string {
  return `${h.intent} for "${h.brand}"${h.territories.length ? ` on ${h.territories.map((t) => `"${t}"`).join(", ")}` : ""}`;
}

function capabilityFor(intent: QueryIntent, n: number): { ok: true; intent: AgentIntent } | { ok: false; code: string; detail: string; question: string } {
  if (EXECUTABLE.has(intent)) return { ok: true, intent: intent as AgentIntent };
  if (intent === "refine_territory" || intent === "switch_territory") {
    if (n === 0) return { ok: false, code: "REFINEMENT_TARGET_MISSING", detail: `${intent} names no concrete territory to investigate`, question: "Which territory, specifically, should be investigated?" };
    return { ok: true, intent: n === 1 ? "analyze_move" : "compare_territories" };
  }
  return { ok: false, code: "UNSUPPORTED_OPERATION", detail: `${intent} has no executable mapping`, question: "What should be investigated?" };
}

function operationFor(intent: QueryIntent, context: ResolvedContext | null, brand: QueryInterpretation["brand"]): InvestigationOperation {
  if (!context) return "NEW_INVESTIGATION";
  const parentBrand = context.nodes[0]!.state.brand.entity;
  if (brand.source === "EXPLICIT" && parentBrand && !same(brand.name!, parentBrand.label)) return "CHANGE_BRAND";
  if (intent === "refine_territory") return "REFINE_TERRITORY";
  if (intent === "switch_territory") return "SWITCH_TERRITORY";
  return "FOLLOW_UP";
}

/** The context territory a follow-up departs from: the caller's selection wins; the model's reference must exist. */
function selectedTerritory(p: QueryProposal, context: ResolvedContext | null, warnings: string[]): string | null {
  if (!context) return null;
  const current = context.nodes[0]!.state;
  if (p.contextTerritoryKey && !current.territories.some((t) => t.key === p.contextTerritoryKey)) warnings.push(`CONTEXT_TERRITORY_KEY_UNKNOWN: ${p.contextTerritoryKey} is not a territory of the current investigation`);
  if (context.selectedTerritoryKey) {
    if (p.contextTerritoryKey && p.contextTerritoryKey !== context.selectedTerritoryKey) warnings.push(`SELECTION_OVERRIDES_REFERENCE: the selected territory ${context.selectedTerritoryKey} is used, not ${p.contextTerritoryKey}`);
    return context.selectedTerritoryKey;
  }
  if (p.contextTerritoryKey && current.territories.some((t) => t.key === p.contextTerritoryKey)) return p.contextTerritoryKey;
  const targets = current.territories.filter((t) => t.role === "target");
  return targets.length === 1 ? targets[0]!.key : null;
}

function plan(
  intent: AgentIntent,
  brand: QueryInterpretation["brand"],
  territories: { name: string }[],
  selectedTerritoryKey: string | null,
  operation: InvestigationOperation,
  input: GateInput,
  parent: AgentRunState | null,
): { ok: true; plan: ExecutionPlan } | { ok: false; code: string; detail: string; question: string } {
  const names = territories.map((t) => t.name);
  if (names.length > MAX_TERRITORIES) return { ok: false, code: "TOO_MANY_TERRITORIES", detail: `${names.length} territories; one investigation takes at most ${MAX_TERRITORIES}`, question: `Which ${MAX_TERRITORIES} territories (at most) should be compared?` };
  // An inherited brand is handed over by its Qloo id: the child run re-resolves (re-verifies) it in Qloo itself.
  const brandArg = brand.source === "INHERITED" && brand.inheritedId ? brand.inheritedId : brand.name!;
  const interpretation = { intent, brand: brandArg, territories: names };
  const schema = interpretationSchema.safeParse(interpretation);
  if (!schema.success) {
    const detail = schema.error.issues.map((i) => i.message).join("; ");
    const question = intent === "analyze_move" ? "Which single territory should be investigated?" : intent === "compare_territories" ? "Which territories (two or more) should be compared?" : "Should the brand's frontier be explored openly, or specific territories investigated?";
    return { ok: false, code: "TERRITORY_CARDINALITY", detail, question };
  }
  const request: AgentRequest = { userQuery: input.query, intent, brand: brandArg, territories: names };
  const check = resolveInterpretation(request, schema.data);
  if (!check.ok) return { ok: false, code: "INTERPRETATION_REJECTED", detail: check.reason, question: "Could you restate the brand and territories to investigate?" };
  const inheritedBrand = brand.source === "INHERITED" && parent?.brand.entity ? { id: parent.brand.entity.id, label: parent.brand.entity.label } : null;
  return {
    ok: true,
    plan: {
      handoff: { intent, brand: brandArg, territories: names, operation },
      request,
      interpretation: check.interpretation,
      link: {
        operation,
        parentRunId: parent?.runId ?? null,
        selectedTerritoryKey,
        inheritedBrand,
        constraints: input.proposal.constraints,
        reason: `${input.proposal.primaryIntent}${parent ? ` from run ${parent.runId}` : ""}`,
      },
    },
  };
}

/**
 * A smaller supported task for a deferred operation: the first named brand investigated alone. It is labelled as not
 * equivalent (no brand is compared with another) and runs only after the user confirms it.
 */
function deferredAlternative(intent: QueryIntent, brands: string[], explicit: ExplicitFields, territories: { name: string }[]): { intent: AgentIntent; brand: string; territories: string[]; description: string } | null {
  if (intent !== "compare_brands" && intent !== "competitor_whitespace") return null;
  const brand = explicit.brand ?? brands[0];
  if (!brand) return null;
  const names = territories.map((t) => t.name);
  const capability: AgentIntent = names.length === 0 ? "explore_frontier" : names.length === 1 ? "analyze_move" : "compare_territories";
  if (names.length > MAX_TERRITORIES) return null;
  return { intent: capability, brand, territories: names, description: `Investigate "${brand}" alone (${capability}${names.length ? ` on ${names.join(", ")}` : ""}). This does not compare brands or rank competitors.` };
}

function returnTarget(p: QueryProposal, context: ResolvedContext, territories: { name: string }[]): { ok: true; runId: string } | { ok: false; code: "ANCESTOR_UNAVAILABLE" | "RETURN_TARGET_UNKNOWN" | "NO_PARENT_INVESTIGATION"; detail: string } {
  const ancestors = context.nodes.slice(1);
  if (p.contextRef && p.contextRef !== "L0") {
    const node = context.nodes.find((n) => n.ref === p.contextRef);
    if (node) return { ok: true, runId: node.state.runId };
  }
  const wanted = [...territories.map((t) => t.name), ...(p.contextTerritoryKey ? [p.contextTerritoryKey] : [])];
  if (wanted.length > 0) {
    const hit = ancestors.find(({ state }) => state.territories.some((t) => t.role === "target" && wanted.some((w) => same(w, t.label) || slugify(w) === t.key)));
    if (hit) return { ok: true, runId: hit.state.runId };
    if (context.view.lineageTruncated) return { ok: false, code: "ANCESTOR_UNAVAILABLE", detail: `no held ancestor investigated ${wanted.join(", ")}; earlier investigations are no longer held by this process` };
    return { ok: false, code: "RETURN_TARGET_UNKNOWN", detail: `no earlier investigation in this lineage targeted ${wanted.join(", ")}` };
  }
  if (ancestors[0]) return { ok: true, runId: ancestors[0].state.runId };
  if (context.view.lineageTruncated) return { ok: false, code: "ANCESTOR_UNAVAILABLE", detail: "the parent investigation is no longer held by this process" };
  return { ok: false, code: "NO_PARENT_INVESTIGATION", detail: "the current investigation has no parent to return to" };
}
