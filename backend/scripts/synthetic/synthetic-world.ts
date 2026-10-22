/**
 * SYNTHETIC Qloo world: a deterministic QlooTransport for the ScriptedToolProvider (tests and
 * `pnpm eval:agent`). It is a TEST INSTRUMENT, not Qloo evidence. Sprint 4 moved it out of backend/src:
 * production code cannot import it (tests/agent-generalization.test.ts enforces this).
 *
 * World data lives in evals/fixtures/synthetic/ (fictional names, placeholder `SYN-` ids,
 * `"fixtureType": "synthetic"`). This module only simulates the harness envelope shapes observed live
 * ([live 2026-10-16] via `qloo mcp`), so the runtime's status policy, validators and methodology run
 * unchanged:
 *   describe     exact name / identifier → ok; ambiguous → needs_input with candidates; unknown → needs_input, no candidates
 *   find_tags    tags whose name shares a word with the query
 *   entity_tags  the entity's tags in world order (then its profileOnlyTags), saturated affinities (as observed live)
 *   recommend    members of the include tags; signal entity → ordered by tag-set similarity,
 *                tag-only signal → flat affinity in id order (as observed live); member type "urn:entity"
 *   rank         options ordered by tag-set similarity to the signal
 * Similarity is a Jaccard over world tag sets: a fixed synthetic rule, not a model of Qloo.
 */
import { z } from "zod";
import { QLOO_RESULT_SCHEMA_VERSION, type QlooOperation } from "../../src/qloo/types.js";
import type { QlooTransport, TransportResult } from "../../src/qloo/transport.js";
import { QlooToolProvider, SYNTHETIC_SOURCE } from "../../src/agent/tool-provider.js";

const worldTagSchema = z.strictObject({ id: z.string().min(1), name: z.string().min(1), type: z.string().min(1), popularity: z.number().optional() });
const worldEntitySchema = z.strictObject({
  id: z.string().regex(/^SYN-/u, "synthetic entity ids must start with SYN-"),
  name: z.string().min(1),
  type: z.string().min(1),
  /** null reproduces the live `popularity: null` member shape (Sprint 5A traces). */
  popularity: z.number().nullable(),
  tags: z.array(z.string().min(1)),
  /**
   * Tags the entity's profile carries that are NOT recommend filters for its type. Reproduces the live quirk that brand
   * profiles carry media/music tags while brand pools for those tags are empty (Sprint 3 and Sprint 5A.1 traces).
   */
  profileOnlyTags: z.array(z.string().min(1)).optional(),
});
const faultSchema = z.strictObject({
  operation: z.string(),
  /** Applies when the JSON input contains this substring. */
  whenInputContains: z.string().optional(),
  status: z.enum(["error", "degraded", "partial"]),
  code: z.string().optional(),
  retryable: z.boolean().optional(),
  /** How many matching calls are affected (then the fault clears). */
  times: z.number().int().min(1),
});
export const syntheticWorldSchema = z.strictObject({
  fixtureType: z.literal("synthetic"),
  notice: z.string().min(1),
  tags: z.array(worldTagSchema),
  entities: z.array(worldEntitySchema),
  ambiguousNames: z.array(z.strictObject({ name: z.string().min(1), candidates: z.array(z.string().min(1)).min(2) })),
  faults: z.array(faultSchema).optional(),
});
export type SyntheticWorld = z.output<typeof syntheticWorldSchema>;
export type SyntheticFault = z.output<typeof faultSchema>;

const norm = (value: string) => value.trim().toLowerCase();
const words = (value: string) =>
  norm(value)
    .split(/[^a-z0-9]+/u)
    .filter((w) => w.length > 2)
    .map((w) => (w.endsWith("s") && w.length > 4 ? w.slice(0, -1) : w));

function hash(value: string): number {
  let h = 2166136261;
  for (let i = 0; i < value.length; i += 1) h = Math.imul(h ^ value.charCodeAt(i), 16777619);
  return (h >>> 0) / 2 ** 32;
}

export class SyntheticWorldTransport implements QlooTransport {
  readonly name = "synthetic-world";
  private counter = 0;
  private readonly faults: (SyntheticFault & { remaining: number })[];
  private readonly entities: Map<string, SyntheticWorld["entities"][number]>;
  private readonly tags: Map<string, SyntheticWorld["tags"][number]>;
  /** Every request received, for assertions in tests (operation + input). */
  readonly requests: { operation: QlooOperation; input: unknown }[] = [];

  constructor(
    private readonly world: SyntheticWorld,
    extraFaults: SyntheticFault[] = [],
  ) {
    syntheticWorldSchema.parse(world);
    this.entities = new Map(world.entities.map((e) => [e.id, e]));
    this.tags = new Map(world.tags.map((t) => [t.id, t]));
    this.faults = [...(world.faults ?? []), ...extraFaults].map((f) => ({ ...f, remaining: f.times }));
  }

  async execute(operation: QlooOperation, input: unknown): Promise<TransportResult> {
    this.requests.push({ operation, input });
    this.counter += 1;
    const correlationId = `syn-${String(this.counter).padStart(4, "0")}`;
    const fault = this.faults.find((f) => f.remaining > 0 && f.operation === operation && (f.whenInputContains === undefined || JSON.stringify(input).includes(f.whenInputContains)));
    if (fault) fault.remaining -= 1;
    if (fault?.status === "error") {
      return { kind: "result", raw: this.envelope(operation, correlationId, "error", { error: { code: fault.code ?? "QLOO_UPSTREAM", layer: "qloo", retryable: fault.retryable ?? false, recovery: "synthetic fault" }, results: [] }) };
    }
    const body = this.simulate(operation, (input ?? {}) as Record<string, unknown>);
    const status = fault ? fault.status : body.status;
    return { kind: "result", raw: this.envelope(operation, correlationId, status, { ...body.fields, ...(fault && { warnings: [`synthetic ${fault.status} result`] }) }) };
  }

  private envelope(operation: QlooOperation, correlationId: string, status: string, fields: Record<string, unknown>) {
    return {
      schema_version: QLOO_RESULT_SCHEMA_VERSION,
      operation,
      status,
      summary: `SYNTHETIC ${operation}`,
      ...fields,
      execution: { transport: "mcp", transport_name: "synthetic-world", correlation_id: correlationId, duration_ms: 0 },
    };
  }

  private interpreted(input: string, id: string, match: string) {
    const entity = this.entities.get(id)!;
    return { input, entityId: entity.id, name: entity.name, type: `urn:entity:${entity.type}`, match };
  }

  private lookup(input: string, type?: string): { id: string; match: string } | undefined {
    if (this.entities.has(input)) return { id: input, match: "identifier" };
    const hit = this.world.entities.find((e) => norm(e.name) === norm(input) && (type === undefined || e.type === type));
    return hit ? { id: hit.id, match: "exact" } : undefined;
  }

  private similarity(a: string, b: string): number {
    const ta = new Set(this.entities.get(a)?.tags ?? []);
    const tb = new Set(this.entities.get(b)?.tags ?? []);
    const shared = [...ta].filter((t) => tb.has(t)).length;
    const union = new Set([...ta, ...tb]).size;
    // Deterministic tie-break below the Jaccard resolution.
    return Math.round(((union === 0 ? 0 : shared / union) * 0.8 + 0.1 + hash(`${a}|${b}`) * 0.001) * 1e6) / 1e6;
  }

  private compactEntity(id: string, affinity?: number, type?: string) {
    const e = this.entities.get(id)!;
    return { entity_id: e.id, name: e.name, type: type ?? `urn:entity:${e.type}`, popularity: e.popularity, ...(affinity !== undefined && { affinity }) };
  }

  private simulate(operation: QlooOperation, input: Record<string, unknown>): { status: string; fields: Record<string, unknown> } {
    const list = (value: unknown) => (Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : []);
    switch (operation) {
      case "describe": {
        const name = String(input.entity ?? "");
        const type = typeof input.type === "string" ? input.type : undefined;
        const ambiguous = this.world.ambiguousNames.find((a) => norm(a.name) === norm(name));
        if (ambiguous && !this.entities.has(name)) {
          const candidates = ambiguous.candidates.map((id) => this.entities.get(id)!).map((e) => ({ id: e.id, name: e.name, type: `urn:entity:${e.type}`, popularity: e.popularity }));
          return { status: "needs_input", fields: { results: [], resolution: { issues: [{ input: name, kind: "ambiguous", input_kind: "entity", field: "entity", candidates }] } } };
        }
        const found = this.lookup(name, type);
        if (!found) return { status: "needs_input", fields: { results: [], resolution: { issues: [{ input: name, kind: "not_found", input_kind: "entity", field: "entity", candidates: [] }] } } };
        return { status: "ok", fields: { interpretation: { entity: this.interpreted(name, found.id, found.match) }, results: [this.compactEntity(found.id)] } };
      }
      case "find_tags": {
        const query = words(String(input.query ?? ""));
        const limit = Number(input.limit ?? 10);
        const scored = this.world.tags
          .map((tag) => ({ tag, score: words(tag.name).filter((w) => query.includes(w)).length }))
          .filter((s) => s.score > 0)
          .sort((a, b) => b.score - a.score || a.tag.name.localeCompare(b.tag.name) || a.tag.id.localeCompare(b.tag.id))
          .slice(0, limit);
        return {
          status: scored.length ? "ok" : "empty",
          fields: { interpretation: { query: input.query, semantic: true }, results: scored.map(({ tag }) => ({ id: tag.id, name: tag.name, type: tag.type, popularity: tag.popularity ?? 0.9 })) },
        };
      }
      case "entity_tags": {
        const ids = list(input.entities).map((value) => this.lookup(value)?.id).filter((id): id is string => id !== undefined);
        const limit = Number(input.limit ?? 10);
        const profile = (id: string) => [...(this.entities.get(id)?.tags ?? []), ...(this.entities.get(id)?.profileOnlyTags ?? [])];
        const tagIds = ids.length === 1 ? profile(ids[0]!) : [...new Set(ids.flatMap(profile))];
        const results = tagIds.slice(0, limit).map((id, i) => ({ id, name: this.tags.get(id)?.name ?? id, type: id.split(":").slice(0, 4).join(":"), affinity: Math.round((1 - i * 0.0005) * 1e6) / 1e6 }));
        return { status: results.length ? "ok" : "empty", fields: { interpretation: { entities: ids.map((id) => this.interpreted(id, id, "identifier")) }, results } };
      }
      case "recommend": {
        const targetType = String(input.target_type ?? "");
        const include = list(input.include_tags);
        const operator = input.include_tags_operator === "intersection" ? "intersection" : "union";
        const signals = list(input.signals).map((s) => this.lookup(s)?.id).filter((id): id is string => id !== undefined);
        const limit = Number(input.limit ?? 10);
        const members = this.world.entities.filter(
          (e) =>
            e.type === targetType &&
            !signals.includes(e.id) &&
            (include.length === 0 || (operator === "union" ? include.some((t) => e.tags.includes(t)) : include.every((t) => e.tags.includes(t)))),
        );
        const signal = signals[0];
        const ordered = signal
          ? members.map((e) => ({ e, a: this.similarity(signal, e.id) })).sort((x, y) => y.a - x.a || x.e.id.localeCompare(y.e.id))
          : members.map((e) => ({ e, a: 0.764996 })).sort((x, y) => x.e.id.localeCompare(y.e.id));
        const results = ordered.slice(0, limit).map(({ e, a }) => this.compactEntity(e.id, a, "urn:entity"));
        return { status: results.length ? "ok" : "empty", fields: { interpretation: { target_type: `urn:entity:${targetType}`, signals: signals.map((id) => this.interpreted(id, id, "identifier")) }, results } };
      }
      case "rank": {
        const options = list(input.options).map((o) => this.lookup(o)?.id).filter((id): id is string => id !== undefined);
        const signal = list(input.signals).map((s) => this.lookup(s)?.id).find((id) => id !== undefined);
        const ordered = options.map((id) => ({ id, a: signal ? this.similarity(signal, id) : 0.5 })).sort((x, y) => y.a - x.a || x.id.localeCompare(y.id));
        return {
          status: ordered.length ? "ok" : "empty",
          fields: {
            interpretation: { options: options.map((id) => this.interpreted(id, id, "identifier")), signals: signal ? [this.interpreted(signal, signal, "identifier")] : [] },
            results: ordered.map(({ id, a }) => this.compactEntity(id, a)),
          },
        };
      }
      default:
        return { status: "error", fields: { error: { code: "SYNTHETIC_UNSUPPORTED", layer: "harness", retryable: false, recovery: `${operation} is not simulated` }, results: [] } };
    }
  }
}

/** The scripted (synthetic) tool provider: a TEST TOOL. Evidence is labelled synthetic end to end. */
export function createScriptedToolProvider(world: SyntheticWorld, faults: SyntheticFault[] = []): QlooToolProvider & { world: SyntheticWorldTransport } {
  const transport = new SyntheticWorldTransport(world, faults);
  const provider = new QlooToolProvider(transport, { name: "synthetic-world", mode: "scripted", evidenceSource: SYNTHETIC_SOURCE, spacingMs: 0, rateLimitWaitMs: 0, sleep: async () => {} });
  return Object.assign(provider, { world: transport });
}
