import { FatalError } from "workflow";
import { z } from "zod";

export const requestSchema = z.object({
  query: z.string().min(1).max(500),
  brand: z.string().min(1).max(120),
  mode: z.enum(["complete", "refuse_retry"]).default("complete"),
});

export async function validateRequest(request: z.infer<typeof requestSchema>) {
  "use step";
  return requestSchema.parse(request);
}

export async function syntheticAgentDecision(validated: z.infer<typeof requestSchema>) {
  "use step";
  return { action: "call_tool" as const, tool: "qloo_find_tags", query: validated.brand };
}

export async function mockedQlooTool(decision: { tool: string; query: string }) {
  "use step";
  return {
    tool: decision.tool,
    tags: 1,
    correlationId: "syn-corr-workflow",
    committed: true,
    operationId: "qloo_find_tags:synthetic",
  };
}

export async function persistStep(result: { correlationId: string; operationId: string }) {
  "use step";
  return { stored: true, result };
}

export async function resumeCommitted(persisted: { stored: boolean; result: unknown }) {
  "use step";
  if (!persisted.stored) throw new FatalError("no committed Qloo step to resume");
  return persisted.result;
}

export async function uncertainExternal(operationId: string) {
  "use step";
  throw new FatalError(`retrying ${operationId} is unsafe`);
}

/**
 * Happy-path synthetic investigation. Completes with a validated artifact.
 * Replay of resumeCommitted is a no-op on already-stored output (SDK step log).
 */
export async function syntheticInvestigationWorkflow(input: z.infer<typeof requestSchema>) {
  "use workflow";
  const validated = await validateRequest(input);
  const decision = await syntheticAgentDecision(validated);
  const tool = await mockedQlooTool(decision);
  const persisted = await persistStep(tool);
  await resumeCommitted(persisted);
  return { status: "COMPLETE" as const, findings: 1, operationId: tool.operationId };
}

/**
 * Official FatalError path: the runtime must not retry a paid-looking external call.
 * FatalError is not catchable inside the workflow; the run fails.
 */
export async function refusedRetryWorkflow(input: z.infer<typeof requestSchema>) {
  "use workflow";
  const validated = await validateRequest(input);
  await uncertainExternal(validated.brand);
  return { status: "UNEXPECTED" as const };
}
