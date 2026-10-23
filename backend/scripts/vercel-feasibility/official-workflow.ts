/**
 * Official Vercel Workflow SDK source for the Sprint 8B feasibility proof.
 *
 * This file uses the documented `"use workflow"` / `"use step"` primitives. Running it as ordinary
 * TypeScript (without the Workflow compiler) is not WORKFLOW_COMPILER_PASS. Hosted execution is a
 * separate gate. External Qloo/Haiku steps are marked non-retryable: a started-but-uncommitted
 * provider call must not be retried blindly.
 */
import { z } from "zod";

export const investigationRequestSchema = z.object({
  query: z.string().min(1).max(500),
  brand: z.string().min(1).max(120),
});

export type InvestigationRequest = z.infer<typeof investigationRequestSchema>;

export class UnsafeExternalRetryError extends Error {
  constructor(readonly operationId: string) {
    super(`retrying ${operationId} is unsafe: the provider call may have happened without a committed result`);
    this.name = "UnsafeExternalRetryError";
  }
}

export type WorkflowStepName =
  | "validate_request"
  | "synthetic_agent_decision"
  | "mocked_qloo_tool"
  | "persist_step"
  | "simulate_interruption"
  | "resume_committed"
  | "uncertain_external"
  | "final_result";

async function validateRequest(request: InvestigationRequest) {
  "use step";
  return investigationRequestSchema.parse(request);
}

async function syntheticAgentDecision(validated: InvestigationRequest) {
  "use step";
  return { action: "call_tool" as const, tool: "qloo_find_tags", query: validated.brand };
}

async function mockedQlooTool(decision: { tool: string; query: string }) {
  "use step";
  return { tool: decision.tool, tags: 1, correlationId: "syn-corr-workflow", committed: true };
}

async function persistStep(result: { correlationId: string }) {
  "use step";
  return { stored: true, operationId: "mocked_qloo_tool", result };
}

async function resumeCommitted(persisted: { stored: boolean; result: unknown }) {
  "use step";
  if (!persisted.stored) throw new Error("no committed Qloo step to resume");
  return persisted.result;
}

async function uncertainExternal(operationId: string) {
  "use step";
  throw new UnsafeExternalRetryError(operationId);
}

async function finalResult(resumed: unknown) {
  "use step";
  return { status: "COMPLETE" as const, findings: 1, resumed };
}

/**
 * Synthetic investigation journey required by Sprint 8B. The `"use workflow"` directive is the
 * official compiler hint. Local unit tests invoke this as a plain async function.
 */
export async function syntheticInvestigationWorkflow(request: InvestigationRequest) {
  "use workflow";
  const validated = await validateRequest(request);
  const decision = await syntheticAgentDecision(validated);
  const tool = await mockedQlooTool(decision);
  const persisted = await persistStep(tool);
  await resumeCommitted(persisted);
  let uncertain: "refused" | "unexpected" = "refused";
  try {
    await uncertainExternal("qloo_find_tags");
    uncertain = "unexpected";
  } catch (error) {
    if (!(error instanceof UnsafeExternalRetryError)) throw error;
  }
  return finalResult({ tool, uncertain });
}

export const OFFICIAL_WORKFLOW_STEPS: readonly WorkflowStepName[] = [
  "validate_request",
  "synthetic_agent_decision",
  "mocked_qloo_tool",
  "persist_step",
  "simulate_interruption",
  "resume_committed",
  "uncertain_external",
  "final_result",
];
