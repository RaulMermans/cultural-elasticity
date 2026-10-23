/**
 * Operator-triggered live probes. Not imported by unit tests. Never logs credential values.
 *
 * One-shot exec + a 1-token Haiku ping. Starting the long-lived MCP subprocess is not a connectivity test.
 */
import Anthropic from "@anthropic-ai/sdk";
import { DEFAULT_AGENT_MODEL } from "../agent/model/anthropic.js";
import { HarnessQlooClient } from "../qloo/client.js";
import { harnessChildEnv, LIVE_QLOO_HOST_VERIFIED, requireHackathonBaseUrl, verifyHarnessHost } from "../qloo/environment.js";
import { defaultHarnessBinPath, HarnessExecTransport } from "../qloo/transport.js";
import { setProviderProbes } from "./providers.js";

export function registerLiveProviderProbes(): void {
  setProviderProbes({
    qloo: async () => {
      if (!process.env.QLOO_API_KEY?.trim()) return { ok: false, detail: "QLOO_API_KEY is not configured." };
      const origin = requireHackathonBaseUrl(process.env.QLOO_API_BASE_URL);
      const childEnv = harnessChildEnv(process.env, origin);
      const gate = verifyHarnessHost(defaultHarnessBinPath(), childEnv, origin);
      if (gate.status !== LIVE_QLOO_HOST_VERIFIED) return { ok: false, detail: "Qloo host gate failed. Harness startup is not connectivity." };
      const client = new HarnessQlooClient(new HarnessExecTransport({ env: childEnv, timeoutMs: 12_000 }));
      const result = await client.findTags({ query: "culture", semantic: true, limit: 1 });
      if (result.kind === "ok" || result.kind === "empty") {
        return { ok: true, detail: `Qloo answered find_tags (${result.kind}).` };
      }
      return { ok: false, detail: `Qloo probe returned ${result.kind}.` };
    },
    haiku: async () => {
      if (!process.env.ANTHROPIC_API_KEY?.trim()) return { ok: false, detail: "ANTHROPIC_API_KEY is not configured." };
      const workspace = process.env.ANTHROPIC_WORKSPACE_ID?.trim();
      const client = new Anthropic(workspace ? { defaultHeaders: { "anthropic-workspace-id": workspace } } : {});
      const response = await client.beta.messages.create(
        {
          model: DEFAULT_AGENT_MODEL,
          max_tokens: 1,
          messages: [{ role: "user", content: "ping" }],
        },
        { timeout: 12_000 },
      );
      if (response.model && response.usage) {
        return { ok: true, detail: `Haiku answered (${response.model}).` };
      }
      return { ok: false, detail: "Haiku probe returned no usage metadata." };
    },
  });
}
