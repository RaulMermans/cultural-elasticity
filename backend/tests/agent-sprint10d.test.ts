/**
 * Sprint 10D regression (live trace L3, 2026-10-30): a same-named PRODUCT-ATTRIBUTE tag must not become a territory's
 * anchor while the territory's own Qloo search returned a concept of another namespace. SYNTHETIC ids only.
 */
import { describe, expect, it } from "vitest";
import { anchorOnObservedMembers } from "../src/agent/frontier.js";
import { incidentalAnchorRefusal, incidentalConcept } from "../src/agent/semantic-comparison.js";
import { addTerritory, findTerritory } from "../src/agent/state.js";
import { freshState } from "./fixtures/synthetic/agent.js";

const MATERIAL = "urn:tag:material:syn:widget";
const CULTURE = "urn:tag:culture:syn:widgets";
const INDUSTRY = "urn:tag:industry:syn:widgets";

function withSearch(tags: string[]) {
  const state = freshState({ userQuery: "SYNTHETIC compare widgets", intent: "compare_territories" });
  for (const id of tags) state.tags.set(id, { id, label: "Widgets", type: id.split(":").slice(0, 4).join(":") } as never);
  state.searchedQueries.set("widgets", tags);
  addTerritory(state, { label: "Widgets", role: "target", origin: "user", rationale: "SYNTHETIC" });
  return state;
}

describe("SYNTHETIC Sprint 10D: incidental attribute anchors", () => {
  it("treats a material tag as an incidental attribute, not a cultural territory", () => {
    expect(incidentalConcept(MATERIAL)?.code).toBe("INCIDENTAL_ATTRIBUTE");
    expect(incidentalConcept(CULTURE)).toBeUndefined();
  });

  it("refuses the attribute anchor only when the territory's own search offered another concept", () => {
    expect(incidentalAnchorRefusal([MATERIAL, CULTURE, INDUSTRY], MATERIAL)).toMatch(/culture:syn:widgets/u);
    expect(incidentalAnchorRefusal([MATERIAL], MATERIAL)).toBeNull();
    expect(incidentalAnchorRefusal(undefined, MATERIAL)).toBeNull();
    expect(incidentalAnchorRefusal([MATERIAL, CULTURE], CULTURE)).toBeNull();
  });

  it("the runtime does not auto-anchor members of the attribute tag, but does anchor the cultural concept", () => {
    const state = withSearch([MATERIAL, CULTURE]);
    expect(anchorOnObservedMembers(state, MATERIAL, "brand", 20)).toEqual([]);
    expect(findTerritory(state, "widgets")!.concept).toBeNull();
    expect(anchorOnObservedMembers(state, CULTURE, "brand", 5)).toEqual(["widgets"]);
    expect(findTerritory(state, "widgets")!.concept?.id).toBe(CULTURE);
  });

  it("with no alternative, the attribute tag can still anchor (a territory that only exists as an attribute)", () => {
    const state = withSearch([MATERIAL]);
    expect(anchorOnObservedMembers(state, MATERIAL, "brand", 20)).toEqual(["widgets"]);
  });
});
