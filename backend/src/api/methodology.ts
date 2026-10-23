import { developmentRoutesOpen } from "./exposure.js";
import type { CulturalElasticityResult } from "@cultural-elasticity/shared";
import type { FastifyInstance } from "fastify";
import type { EvidenceIssue } from "../evidence/schema.js";
import { MethodologyInputError } from "../methodology/contracts.js";
import { analyzeElasticity } from "../methodology/elasticity.js";
import { ElasticityInvariantError } from "../methodology/validate.js";

type MethodologyErrorResponse =
  | { error: "invalid_methodology_input"; issues: EvidenceIssue[] }
  | { error: "methodology_invariant_violation"; message: string }
  | { error: "not_found"; message: string };

/**
 * Development endpoint: fully assembled methodology input in, CulturalElasticityResult out.
 * Deterministic and offline: no Qloo call, no LLM, no agent. Not yet a public product endpoint.
 */
export async function methodologyRoutes(app: FastifyInstance): Promise<void> {
  app.post<{ Body: unknown; Reply: CulturalElasticityResult | MethodologyErrorResponse }>("/api/methodology/analyze", { bodyLimit: 5 * 1024 * 1024 }, async (request, reply) => {
    if (!developmentRoutesOpen()) return reply.code(404).send({ error: "not_found", message: "This route is not available." });
    try {
      return analyzeElasticity(request.body);
    } catch (error) {
      if (error instanceof MethodologyInputError) return reply.code(400).send({ error: "invalid_methodology_input", issues: error.issues });
      if (error instanceof ElasticityInvariantError) {
        request.log.error({ violations: error.violations }, "methodology invariant violation");
        return reply.code(500).send({ error: "methodology_invariant_violation", message: "the methodology produced an output that failed its own invariants" });
      }
      throw error;
    }
  });
}
