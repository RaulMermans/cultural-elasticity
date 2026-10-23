import { FatalError } from "workflow";
import { z } from "zod";

export const requestSchema = z.object({
  query: z.string().min(1).max(500),
  brand: z.string().min(1).max(120),
});

async function validateRequest(request: z.infer<typeof requestSchema>) {
  "use step";
  return requestSchema.parse(request);
}

async function syntheticAgentDecision(validated: z.infer<typeof requestSchema>) {
  "use step";
  return { action: "call_tool" as const, tool: "qloo_find_tags", query: validated.brand };
}

async function mockedQlooTool(decision: { tool: string; query: string }) {
  "use step";
  return { tool: decision.tool, tags: 1, correlationId: "syn-corr-workflow", committed: true, operationId: "qloo_find_tags:synthetic" };
}

async function persistStep(result: { correlationId: string; operationId: string }) {
  "use step";
  return { stored: true, result };
}

async function resumeCommitted(persisted: { stored: boolean; result: unknown }) {
  "use step";
  if (!persisted.stored) throw new FatalError("no committed Qloo step to resume");
  return persisted.result;
}

async function uncertainExternal(operationId: string) {
  "use step";
  throw new FatalError(`retrying ${operationId} is unsafe`);
}

export async function syntheticInvestigationWorkflow(input: z.infer<typeof requestSchema>) {
  "use workflow";
  const validated = await validateRequest(input);
  const decision = await syntheticAgentDecision(validated);
  const tool = await mockedQlooTool(decision);
  const persisted = await persistStep(tool);
  await resumeCommitted(persisted);
  let uncertain: "refused" | "unexpected" = "refused";
  try {
    await uncertainExternal("qloo_find_tags");
    uncertain = "unexpected";
  } catch (error) {
    if (!(error instanceof FatalError) && !(error instanceof Error && error.name === "FatalError")) throw error;
  }
  return { status: "COMPLETE" as const, findings: 1, uncertain };
}
