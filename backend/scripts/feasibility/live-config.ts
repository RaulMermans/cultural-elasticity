/**
 * Sprint 0B pinned live investigation. Every human judgement is here, with its reason.
 * IDs were observed in live hackathon-API responses on 2026-10-16 and reviewed before pinning.
 * See docs/sprint-0/QLOO_TECHNICAL_FEASIBILITY.md (Pinned Brand, Pinned Territory, Candidate Ranking).
 */
export type PinnedEntity = { id: string; label: string; type: string; note?: string };
export type RankingCandidate = { territory: string; primary: PinnedEntity; alternate?: PinnedEntity; approximation?: string };

export type LiveInvestigationConfig = {
  brand: PinnedEntity & { query: string };
  territory: {
    label: string;
    meaning: string;
    tagQueries: string[];
    pinnedTag: PinnedEntity;
    rejectedTags: { id: string; reason: string }[];
    /** Qloo-native exemplar query: pinned tag ∩ place-category hotel, popularity percentile ≥ min. */
    exemplarQuery: { categoryTag: string; popularityMin: number; take: number };
    /** Human-reviewed subset of the exemplar query's results (design-led boutique hotels). */
    exemplars: PinnedEntity[];
    rejectedExemplars: { label: string; reason: string }[];
    /** A tag counts toward the derived target profile when it recurs in at least this many exemplars. */
    recurringMinSupport: number;
  };
  ranking: { optionType: "brand"; candidates: RankingCandidate[] };
  bridges: { label: string; exemplar: PinnedEntity }[];
  /** [live] compare_audiences with 10 entities in a group was rate-limited on both attempts; 1-entity groups were not. */
  audienceExemplarCap: number;
  tagLimit: number;
  topN: number[];
  momentumWindowDays: number;
  /** Pause between live calls; the hackathon API rate-limited bursts on 2026-10-16. */
  callSpacingMs: number;
};

const brandEntity = "urn:entity:brand";
const placeEntity = "urn:entity:place";

export const LIVE_INVESTIGATION: LiveInvestigationConfig = {
  brand: {
    query: "Jacquemus",
    id: "93A50AC5-FCF2-4F47-87C0-E821E0B9F823",
    label: "Jacquemus",
    type: brandEntity,
    note: "Only brand result for /search?query=Jacquemus&types=urn:entity:brand. Simon Porte Jacquemus is a separate urn:entity:person (CA00D624-…); stores are separate urn:entity:place entities.",
  },
  territory: {
    label: "Boutique Hospitality",
    meaning: "boutique / design-led hospitality as a potential brand-extension territory",
    tagQueries: ["Boutique Hospitality", "Boutique Hotel", "Luxury Hospitality", "Hospitality", "Hotels", "Design Hotel"],
    pinnedTag: {
      id: "urn:tag:interests:qloo:boutique_hospitality",
      label: "Boutique Hospitality",
      type: "urn:tag:interests:qloo",
      note: "Exact label; an interest (taste) concept rather than a facility attribute; filters to recognisable boutique hotels when combined with the hotel category.",
    },
    rejectedTags: [
      { id: "urn:tag:amenity:qloo:boutique_hotel", reason: "facility attribute; as a filter it returned restaurants, a visitor centre and wine bars" },
      { id: "urn:tag:setting:qloo:boutique_hotel", reason: "viable alternative (kept for exemplar sensitivity); its hotel set is less design-led (resorts, conference hotels)" },
      { id: "urn:tag:lifestyle:qloo:boutique_hospitality", reason: "returned 0 place entities" },
      { id: "urn:tag:interests:qloo:design_hotels", reason: "closest to 'design-led' but sparse: 2 places at popularity ≥ 0.95" },
      { id: "urn:tag:setting:qloo:design_hotel", reason: "sparse (6 places at popularity ≥ 0.95), mixed with chain hotels" },
      { id: "urn:tag:lifestyle:qloo:luxury_hospitality", reason: "luxury, not boutique/design-led" },
      { id: "urn:tag:category:place:hotel", reason: "generic hotel category; used only as the intersection filter" },
    ],
    exemplarQuery: { categoryTag: "urn:tag:category:place:hotel", popularityMin: 0.95, take: 20 },
    exemplars: [
      { id: "6DB27280-2C4D-418E-BE1C-8DE7A3D7C4C8", label: "TRUNK(HOTEL)", type: placeEntity },
      { id: "52895C5E-1FED-42D4-923D-ED461750B0F6", label: "Pikes Ibiza", type: placeEntity },
      { id: "D1872812-15F2-4D2A-BCA0-1B808A24FB9A", label: "The Culver Hotel", type: placeEntity },
      { id: "D53324F6-8E1D-40F4-8E5B-28601E7E3F08", label: "Posada Margherita", type: placeEntity },
      { id: "DF5C44A0-FD83-4E43-9948-9CFEF6FA3746", label: "Hôtel Particulier", type: placeEntity },
      { id: "8C070067-51AE-45C2-A478-58707E47BD31", label: "Room Mate Aitana", type: placeEntity },
      { id: "410E9303-068B-4910-A71F-B37A91224F16", label: "The Box House Hotel", type: placeEntity },
      { id: "B37DEB42-6B5A-4324-BE54-DAD016420210", label: "The Margi", type: placeEntity },
      { id: "BBE366F9-8E8B-43A5-A9B3-AD717F102E78", label: "Great John Street Hotel", type: placeEntity },
      { id: "4FA141C9-7141-45FC-B52F-3FB2805D21B9", label: "The Crow's Nest", type: placeEntity },
    ],
    rejectedExemplars: [
      { label: "The Edgewater Hotel", reason: "classic waterfront hotel, not design-led boutique" },
      { label: "Ekante Bliss, Tirupati - IHCL SeleQtions", reason: "chain-collection pilgrimage hotel" },
      { label: "Costa d'Este Beach Resort & Spa", reason: "beach resort" },
      { label: "Ace of Hua Hin Resort", reason: "resort; name collision with Ace Hotel" },
      { label: "Andaz Savannah, by Hyatt", reason: "chain lifestyle brand" },
      { label: "Tsar Palace Luxury Hotel & SPA", reason: "palace luxury, not boutique/design-led" },
    ],
    recurringMinSupport: 2,
  },
  ranking: {
    optionType: "brand",
    candidates: [
      { territory: "Boutique Hospitality", primary: { id: "DD515B0F-B984-49F1-B639-0FD3E1FC65D7", label: "Ace Hotel", type: brandEntity }, alternate: { id: "49892C6A-7735-446E-B120-CB78360EA183", label: "The Hoxton", type: brandEntity } },
      {
        territory: "Ceramics",
        primary: { id: "EE1DE5CF-185B-45E0-9C00-FBE776E2EE18", label: "Heath Ceramics", type: brandEntity },
        approximation: "Astier de Villatte exists in Qloo only as urn:entity:place stores, not as a brand.",
      },
      { territory: "Furniture", primary: { id: "52C68410-550C-4AB5-8966-E1107D6D8EBD", label: "HAY", type: brandEntity }, alternate: { id: "CA45269A-77BE-4F89-A882-F219A7941A13", label: "VITRA", type: brandEntity } },
      {
        territory: "Sailing / marine lifestyle",
        primary: { id: "9988753F-84A3-40F4-95A1-56680C40FB20", label: "Helly Hansen", type: brandEntity },
        alternate: { id: "8142789A-E5FC-43AF-B071-CAE37EE15886", label: "Sebago", type: brandEntity },
        approximation: "North Sails and Henri Lloyd exist only as place stores; Musto was not found. Helly Hansen (sailing heritage, outdoor) and Sebago (nautical footwear) are weak proxies.",
      },
      {
        territory: "Wellness",
        primary: { id: "AAEFD086-F7CF-4397-B3A5-8077E3DADD3D", label: "Six Senses", type: brandEntity },
        alternate: { id: "32F867B9-E6DF-44C3-BCE4-40160C7ED5E4", label: "Aesop", type: brandEntity },
        approximation: "Six Senses is also a hospitality brand, so it does not separate wellness from hospitality.",
      },
      { territory: "Gaming Hardware", primary: { id: "D73F5D9A-6A4B-447F-9041-09813F22F85E", label: "Razer", type: brandEntity }, alternate: { id: "9C5B755A-1BCE-48F6-8890-A44ADE5E16BD", label: "Steel Series", type: brandEntity, note: "SteelSeries; Qloo label is 'Steel Series'." } },
    ],
  },
  bridges: [
    { label: "Boutique Hospitality", exemplar: { id: "DD515B0F-B984-49F1-B639-0FD3E1FC65D7", label: "Ace Hotel", type: brandEntity } },
    { label: "Gaming Hardware", exemplar: { id: "D73F5D9A-6A4B-447F-9041-09813F22F85E", label: "Razer", type: brandEntity } },
  ],
  audienceExemplarCap: 3,
  tagLimit: 20,
  topN: [5, 10, 15, 20],
  momentumWindowDays: 365,
  callSpacingMs: 7_000,
};
