import type { QlooInsightsType, QlooSearchType } from "../../src/qloo/types.js";

/**
 * The Sprint 0 investigation. Every human judgement call lives here, visibly, rather than in code.
 */
export type InvestigationConfig = {
  brand: { query: string; type: QlooInsightsType };
  target: {
    label: string;
    /** Tried in this priority order. Without a pinned tag, the first non-empty query's first candidate is used and marked unconfirmed. */
    tagQueries: string[];
    /** Set after a human reviews the tag candidates from a live run. */
    pinnedTagId: string | undefined;
    exemplarType: QlooInsightsType;
    exemplarLimit: number;
  };
  ranking: {
    optionType: QlooInsightsType;
    /**
     * ASSUMPTION: Qloo ranks entities, not abstract territories, and every option in a call must share
     * one type. Each territory is therefore represented by ONE human-chosen exemplar brand.
     * Results show how the exemplar ranks, which is not necessarily how the territory would.
     */
    candidates: { territory: string; exemplar: string }[];
  };
  bridges: { label: string; exemplars: "target" | { names: string[]; type: QlooSearchType } }[];
  /** Brand count is 1, so exemplars are capped to limit how far they dominate joint-tag calls. */
  jointTagExemplarCap: number;
  tagTopN: number;
  momentumWindowDays: number;
};

export const DEFAULT_INVESTIGATION: InvestigationConfig = {
  brand: { query: "Jacquemus", type: "brand" },
  target: {
    label: "Boutique Hospitality",
    tagQueries: ["Boutique Hospitality", "Boutique Hotel", "Luxury Hospitality", "Hospitality", "Hotels"],
    pinnedTagId: undefined,
    exemplarType: "place",
    exemplarLimit: 10,
  },
  ranking: {
    optionType: "brand",
    candidates: [
      { territory: "Boutique Hotel", exemplar: "Ace Hotel" },
      { territory: "Ceramics", exemplar: "Astier de Villatte" },
      { territory: "Furniture", exemplar: "HAY" },
      { territory: "Sailing Experience", exemplar: "North Sails" },
      { territory: "Wellness Retreat", exemplar: "Six Senses" },
      { territory: "Gaming Hardware", exemplar: "Razer" },
    ],
  },
  bridges: [
    { label: "Boutique Hospitality", exemplars: "target" },
    { label: "Gaming Hardware", exemplars: { names: ["Razer"], type: "brand" } },
  ],
  jointTagExemplarCap: 3,
  tagTopN: 20,
  momentumWindowDays: 365,
};
