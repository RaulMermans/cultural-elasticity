import type { AnalysisIngredients } from "@cultural-elasticity/shared";
import type { FastifyInstance } from "fastify";
import { analyzeEvidencePacket } from "../analysis/ingredients.js";
import { AnalysisInvariantError } from "../analysis/validate.js";
import { EvidenceValidationError, type EvidenceIssue } from "../evidence/schema.js";

type AnalysisErrorResponse =
  | { error: "invalid_evidence_packet"; issues: EvidenceIssue[] }
  | { error: "analysis_invariant_violation"; message: string };

/**
 * Development endpoint: EvidencePacket in, AnalysisIngredients out. Fully offline and deterministic.
 * It never calls Qloo and is not yet a public product endpoint.
 */
export async function analysisRoutes(app: FastifyInstance): Promise<void> {
  app.post<{ Body: unknown; Reply: AnalysisIngredients | AnalysisErrorResponse }>("/api/analysis/ingredients", async (request, reply) => {
    try {
      return analyzeEvidencePacket(request.body);
    } catch (error) {
      if (error instanceof EvidenceValidationError) {
        return reply.code(400).send({ error: "invalid_evidence_packet", issues: error.issues });
      }
      if (error instanceof AnalysisInvariantError) {
        request.log.error({ violations: error.violations }, "analysis invariant violation");
        return reply.code(500).send({ error: "analysis_invariant_violation", message: "the engine produced an output that failed its own invariants" });
      }
      throw error;
    }
  });
}
