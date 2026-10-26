/** SYNTHETIC methodology cases. Placeholder IDs and envelopes are never live Qloo evidence. */
import type { AgentTerritoryResult } from "@cultural-elasticity/shared";
import type { LiveCall } from "../../../src/qloo/live-adapter.js";
import { freshState } from "./agent.js";

const call = (status: string, id = "SYN-CALL-REL") => ({ operation: "recommend", source: "synthetic-fixture", envelope: { status, execution: { correlation_id: id } } }) as unknown as LiveCall;

export function syntheticHypothesisCase() {
  const state = freshState({ userQuery: "SYNTHETIC: Could Atlas Brand investigate Ritual Design?", intent: "analyze_move", brand: "Atlas Brand", territories: ["Ritual Design"], researchMode: "single_hypothesis_v1" });
  state.status = "COMPLETE";
  state.brand.entity = { id: "SYN-BRAND-1", label: "Atlas Brand", type: "urn:entity:brand", match: "exact", resolution: "confirmed", call: call("ok", "SYN-CALL-BRAND") };
  state.profiles.set("SYN-BRAND-1", { subjectId: "SYN-BRAND-1", call: call("ok", "SYN-CALL-PROFILE"), tagIds: ["urn:tag:synthetic:brand_core"], take: 20 });
  state.pools.push({ tagIds: ["urn:tag:synthetic:ritual_design"], targetType: "place", conditionedOn: "SYN-BRAND-1", call: call("ok"), memberIds: ["SYN-PLACE-1", "SYN-PLACE-2"] });
  const target = {
    key: "ritual_design", label: "Ritual Design", resolvedConcept: { id: "urn:tag:synthetic:ritual_design", label: "Ritual Design", type: "urn:tag:synthetic" },
    representation: { exemplars: [{ id: "SYN-PLACE-3" }] },
    coherence: { consistentlyShared: [{ id: "urn:tag:synthetic:craft", label: "Craft" }] },
    conditionedEvidence: { support: "QUERY_SCOPED", entityCount: 2, topEntities: [], correlationId: "SYN-CALL-REL" },
    provenance: { correlationIds: ["SYN-CALL-REL", "SYN-CALL-PROFILE"], sources: ["synthetic-fixture"] },
    limitations: [],
  } as unknown as AgentTerritoryResult;
  return { state, target };
}
