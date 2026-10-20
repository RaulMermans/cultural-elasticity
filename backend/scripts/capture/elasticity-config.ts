/**
 * Sprint 2 pinned capture for the Cultural Elasticity benchmark. Every human judgement is here, with
 * its reason. IDs were observed in live hackathon-API responses on 2026-10-16 (Sprint 0B pins plus
 * Sprint 2 exploratory resolution) and reviewed before pinning. Exemplars were chosen from category
 * knowledge, NOT from any brand-conditioned result list, so no benchmark brand shaped its own panel.
 */
export type PinnedEntity = { id: string; label: string; type: string; note?: string };

export type CaptureTerritory = {
  id: string;
  label: string;
  /** Pinned Qloo tag that anchors the territory and filters the brand-conditioned query. */
  concept: PinnedEntity;
  /** Qloo `recommend` target type for the brand-conditioned query. */
  conditionedTargetType: "place" | "brand";
  /** In panel order: index 0 = primary (panel A), 1 = panel B, 2 = panel C. */
  exemplars: PinnedEntity[];
  rejectedExemplars: { label: string; reason: string }[];
  assumptions: string[];
  approximationWarnings: string[];
};

export type CaptureBrand = PinnedEntity & { key: string; query: string };

export type CapturePanel = { id: string; purpose: "primary" | "alternate" | "repeat"; repeatOf?: string; exemplarIndex: number };

export type ElasticityCaptureConfig = {
  tagTake: number;
  conditionedLimit: number;
  callSpacingMs: number;
  brands: CaptureBrand[];
  territories: CaptureTerritory[];
  panels: CapturePanel[];
};

const brand = "urn:entity:brand";
const DESIGN_LED = "Representation = recognisable brand exemplars; the territory is what these exemplars have in common for Qloo, not the whole category.";

export const ELASTICITY_CAPTURE: ElasticityCaptureConfig = {
  tagTake: 20,
  conditionedLimit: 20,
  callSpacingMs: 7_000,
  brands: [
    { key: "jacquemus", query: "Jacquemus", id: "93A50AC5-FCF2-4F47-87C0-E821E0B9F823", label: "Jacquemus", type: brand },
    { key: "muji", query: "Muji", id: "E12201A5-CC50-40AF-97AE-C54A2CA303F7", label: "Muji", type: brand },
    { key: "alienware", query: "Alienware", id: "2112ADD3-D05E-4CA3-B894-03F8FA6B6C4D", label: "Alienware", type: brand },
    { key: "patagonia", query: "Patagonia", id: "DB4CE34E-3A63-4947-946F-9D52502C5762", label: "Patagonia", type: brand },
    { key: "lululemon", query: "Lululemon", id: "D9B9B404-7B35-4E4B-A0CE-4CAB8155FE9E", label: "Lululemon", type: brand },
    { key: "nintendo", query: "Nintendo", id: "FFD31D42-DF50-4B60-932C-7497C8E73A80", label: "Nintendo", type: brand },
  ],
  territories: [
    {
      id: "boutique_hospitality",
      label: "Boutique Hospitality",
      concept: { id: "urn:tag:interests:qloo:boutique_hospitality", label: "Boutique Hospitality", type: "urn:tag:interests:qloo", note: "Sprint 0B pin: an interest (taste) concept; with the hotel category it yields design-led boutique hotels." },
      conditionedTargetType: "place",
      exemplars: [
        { id: "DD515B0F-B984-49F1-B639-0FD3E1FC65D7", label: "Ace Hotel", type: brand },
        { id: "49892C6A-7735-446E-B120-CB78360EA183", label: "The Hoxton", type: brand },
        { id: "AFD6CD41-7888-413D-885D-E119DB00DE68", label: "Soho House", type: brand, note: "Members' club with hotels; broader than boutique hotels." },
      ],
      rejectedExemplars: [
        { label: "Mama Shelter", reason: "not resolvable as a brand (needs_input, no candidates)" },
        { label: "CitizenM", reason: "resolves, but kept as a spare: lower popularity (0.80) and an affordable-chain positioning" },
      ],
      assumptions: ["Hotel brands stand in for the experience of boutique hospitality.", DESIGN_LED],
      approximationWarnings: ["The brand-conditioned list returns hotel PLACES (Sprint 0B validated), while panel exemplars are hotel BRANDS."],
    },
    {
      id: "ceramics",
      label: "Ceramics",
      concept: { id: "urn:tag:industry:qloo:ceramics", label: "Ceramics", type: "urn:tag:industry:qloo", note: "Returns ceramics manufacturers as brands; urn:tag:interests:qloo:ceramics returned no brands." },
      conditionedTargetType: "brand",
      exemplars: [
        { id: "EE1DE5CF-185B-45E0-9C00-FBE776E2EE18", label: "Heath Ceramics", type: brand },
        { id: "0D24B752-7E4E-4C9B-B764-C8CA1D9C9CF5", label: "Royal Copenhagen", type: brand, note: "Heritage porcelain. Its Qloo tag profile contains unrelated media tags (possible entity conflation)." },
        { id: "D89450A8-3645-4755-9903-8DAA1D1CC10A", label: "Wedgwood", type: brand, note: "Heritage fine china and ceramics." },
      ],
      rejectedExemplars: [
        { label: "Astier de Villatte", reason: "exists only as place stores, not as a brand" },
        { label: "East Fork, Hasami Porcelain, Mud Australia", reason: "not resolvable as brands" },
        { label: "Villeroy & Boch", reason: "resolvable, but first surfaced in a Jacquemus-conditioned list; excluded to avoid brand-shaped exemplar selection" },
      ],
      assumptions: [DESIGN_LED],
      approximationWarnings: ["Mixes a craft studio (Heath) with heritage porcelain houses (Royal Copenhagen, Wedgwood)."],
    },
    {
      id: "furniture",
      label: "Furniture",
      concept: { id: "urn:tag:industry:qloo:furniture", label: "Furniture", type: "urn:tag:industry:qloo", note: "Returns furniture makers as brands; urn:tag:interests:qloo:furniture returned no brands." },
      conditionedTargetType: "brand",
      exemplars: [
        { id: "52C68410-550C-4AB5-8966-E1107D6D8EBD", label: "HAY", type: brand },
        { id: "CA45269A-77BE-4F89-A882-F219A7941A13", label: "VITRA", type: brand },
        { id: "02610282-EFD6-4962-920F-49312B296A93", label: "MUUTO", type: brand },
      ],
      rejectedExemplars: [{ label: "Herman Miller", reason: "resolvable; kept as a spare (office/task seating skews the territory toward workplace furniture)" }],
      assumptions: [DESIGN_LED],
      approximationWarnings: ["All three are European design-furniture brands; the territory means design furniture, not mass-market furniture."],
    },
    {
      id: "sailing_marine",
      label: "Sailing / marine lifestyle",
      concept: { id: "urn:tag:customer_segment:qloo:sailors", label: "Sailors", type: "urn:tag:customer_segment:qloo", note: "Present on all candidate exemplars' tag profiles. Interest/activity sailing tags returned no brands." },
      conditionedTargetType: "brand",
      exemplars: [
        { id: "9988753F-84A3-40F4-95A1-56680C40FB20", label: "Helly Hansen", type: brand, note: "Sailing heritage, but its Qloo profile is mostly outdoor and ski." },
        { id: "8142789A-E5FC-43AF-B071-CAE37EE15886", label: "Sebago", type: brand, note: "Nautical footwear." },
        { id: "DA3235BA-5CB9-4705-BA77-B5C3E15A22FE", label: "Sperry", type: brand, note: "Boat shoes; Qloo tags: Sailing, Sailors, Nautical, Coastal Living." },
      ],
      rejectedExemplars: [
        { label: "North Sails, Henri Lloyd", reason: "exist only as place stores" },
        { label: "Musto, Gill, Zhik", reason: "not resolvable as brands" },
        { label: "Slam", reason: "resolves, but its tag profile mixes sailing with hip-hop/rap tags (likely entity conflation)" },
        { label: "Nautica", reason: "resolves; nautical-styled mass fashion, kept as a spare" },
      ],
      assumptions: [DESIGN_LED],
      approximationWarnings: ["No dedicated sailing-equipment brand could be resolved. Two of three exemplars are boat-shoe brands; this territory is a weak proxy for sailing culture."],
    },
    {
      id: "wellness",
      label: "Wellness",
      concept: { id: "urn:tag:industry:qloo:wellness", label: "Wellness", type: "urn:tag:industry:qloo", note: "Returns wellness resorts and beauty brands; urn:tag:lifestyle:qloo:wellness mixed in lingerie and swimwear." },
      conditionedTargetType: "brand",
      exemplars: [
        { id: "AAEFD086-F7CF-4397-B3A5-8077E3DADD3D", label: "Six Senses", type: brand, note: "Wellness resort brand; also a hospitality brand." },
        { id: "32F867B9-E6DF-44C3-BCE4-40160C7ED5E4", label: "Aesop", type: brand, note: "Skincare." },
        { id: "5D51C800-4EBC-4C14-8ED6-64B2D066BC6F", label: "Goop", type: brand, note: "Wellness lifestyle media and products." },
      ],
      rejectedExemplars: [{ label: "Therabody", reason: "resolves, but its tag profile is dominated by music and venue tags" }],
      assumptions: [DESIGN_LED],
      approximationWarnings: ["Heterogeneous exemplars (resort, skincare, lifestyle media). Six Senses confounds wellness with hospitality."],
    },
    {
      id: "gaming_hardware",
      label: "Gaming Hardware",
      concept: { id: "urn:tag:industry:qloo:gaming_hardware", label: "Gaming Hardware", type: "urn:tag:industry:qloo" },
      conditionedTargetType: "brand",
      exemplars: [
        { id: "D73F5D9A-6A4B-447F-9041-09813F22F85E", label: "Razer", type: brand },
        { id: "9C5B755A-1BCE-48F6-8890-A44ADE5E16BD", label: "Steel Series", type: brand, note: "SteelSeries; Qloo label is 'Steel Series'." },
        { id: "9AF96B7A-6AD0-4A20-819F-091582B82B74", label: "Corsair", type: brand },
      ],
      rejectedExemplars: [{ label: "HyperX", reason: "resolves; kept as a spare (two HyperX entities exist in Qloo)" }],
      assumptions: [DESIGN_LED],
      approximationWarnings: [],
    },
  ],
  panels: [
    { id: "A", purpose: "primary", exemplarIndex: 0 },
    { id: "A-repeat", purpose: "repeat", repeatOf: "A", exemplarIndex: 0 },
    { id: "B", purpose: "alternate", exemplarIndex: 1 },
    { id: "C", purpose: "alternate", exemplarIndex: 2 },
  ],
};
