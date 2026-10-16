/** Operational tag policy and set-only cultural coherence. SYNTHETIC data only. */
import { describe, expect, it } from "vitest";
import { coherenceBand, coherenceView, exemplarCoherence } from "../src/methodology/coherence.js";
import { applyOperationalTagPolicy, matchOperationalRule, OPERATIONAL_TAG_POLICY_VERSION, OPERATIONAL_TAG_RULES, tagNamespace } from "../src/methodology/operational-tags.js";
import { tag, tagProfile } from "./fixtures/synthetic/methodology.js";

describe("OperationalTagPolicyV1", () => {
  it("classifies each observed operational namespace and gives a rule and a reason", () => {
    const operational = ["credit_card:place", "hotel_rating:place", "specialty_dish:place", "cost_description:place", "inclusivity:place", "genre:place", "amenity:place", "offerings:place", "service_option:place"];
    for (const ns of operational) {
      const rule = matchOperationalRule(tag(ns, "x", "c"));
      expect(rule, ns).toBeDefined();
      expect(rule!.reason.length).toBeGreaterThan(10);
    }
  });

  it("keeps curated concept namespaces and taste genres, including qloo amenities and media keywords", () => {
    for (const ns of ["amenity:qloo", "lifestyle:qloo", "aesthetic_property:qloo", "customer_segment:qloo", "genre:media", "genre:music", "keyword:media", "inclusivity:qloo", "industry:qloo"]) {
      expect(matchOperationalRule(tag(ns, "x", "c")), ns).toBeUndefined();
    }
  });

  it("parses namespace and source from the category, falling back to the id", () => {
    expect(tagNamespace({ id: "urn:tag:credit_card:place:syn-x", category: "urn:tag:credit_card:place" })).toEqual({ namespace: "credit_card", source: "place" });
    expect(tagNamespace({ id: "urn:tag:genre:place:hotel:syn-x" })).toEqual({ namespace: "genre", source: "place" });
    expect(tagNamespace({ id: "syn-not-a-urn" })).toBeUndefined();
  });

  it("never deletes: RAW is untouched, kept + excluded = raw, every exclusion is inspectable", () => {
    const profile = tagProfile("syn-p", "P", [
      { ns: "keyword:qloo", name: "a" },
      { ns: "credit_card:place", name: "pay" },
      { ns: "specialty_dish:place", name: "dish" },
    ]);
    const before = structuredClone(profile);
    const filtered = applyOperationalTagPolicy(profile);
    expect(profile).toEqual(before);
    expect(filtered.raw).toBe(profile);
    expect(filtered.keptSignals.length + filtered.excludedSignals.length).toBe(profile.signals.length);
    expect(filtered.excludedSignals.map((e) => e.rule)).toEqual(["payment", "menu_item"]);
    expect(filtered.excludedSignals.every((e) => e.reason && e.signal.id && e.signal.label)).toBe(true);
    expect(filtered.policyVersion).toBe(OPERATIONAL_TAG_POLICY_VERSION);
  });

  it("has unique rule ids", () => {
    expect(new Set(OPERATIONAL_TAG_RULES.map((r) => r.id)).size).toBe(OPERATIONAL_TAG_RULES.length);
  });
});

describe("set-only coherence", () => {
  const brand = tagProfile("syn-brand", "B", [
    { ns: "keyword:qloo", name: "a" },
    { ns: "keyword:qloo", name: "b" },
    { ns: "credit_card:place", name: "pay" },
  ]);
  const exemplar = tagProfile("syn-ex", "E", [
    { ns: "keyword:qloo", name: "a" },
    { ns: "credit_card:place", name: "pay" },
    { ns: "lifestyle:qloo", name: "c" },
  ]);

  it("computes counts, Jaccard, overlap coefficient and the three membership lists", () => {
    const c = exemplarCoherence(brand, { id: "syn-ex", label: "E" }, exemplar);
    expect(c).toMatchObject({ status: "available", brandSignalCount: 3, targetSignalCount: 3, sharedCount: 2, unionCount: 4, jaccard: 0.5, overlapCoefficient: 0.666667 });
    expect(c.shared.map((s) => s.label)).toEqual(["Synthetic pay", "Synthetic a"]);
    expect(c.brandOnly.map((s) => s.label)).toEqual(["Synthetic b"]);
    expect(c.targetOnly.map((s) => s.label)).toEqual(["Synthetic c"]);
  });

  it("filtered overlap shares no more than raw overlap and can reveal an operational-only relationship", () => {
    const raw = exemplarCoherence(brand, { id: "e", label: "E" }, exemplar);
    const filtered = exemplarCoherence(applyOperationalTagPolicy(brand).filtered, { id: "e", label: "E" }, applyOperationalTagPolicy(exemplar).filtered);
    expect(filtered.sharedCount!).toBeLessThanOrEqual(raw.sharedCount!);
    const onlyPay = tagProfile("syn-ex2", "E2", [{ ns: "credit_card:place", name: "pay" }, { ns: "lifestyle:qloo", name: "z" }]);
    const rawPay = exemplarCoherence(brand, { id: "e2", label: "E2" }, onlyPay);
    const filteredPay = exemplarCoherence(applyOperationalTagPolicy(brand).filtered, { id: "e2", label: "E2" }, applyOperationalTagPolicy(onlyPay).filtered);
    expect(rawPay.sharedCount).toBe(1);
    expect(filteredPay.sharedCount).toBe(0);
  });

  it("ignores tag affinity values entirely", () => {
    const reweighted = { ...exemplar, signals: exemplar.signals.map((s, i) => ({ ...s, numeric: { value: i * 1000 + 7, comparisonScope: "within_call" as const } })) };
    expect(exemplarCoherence(brand, { id: "e", label: "E" }, reweighted)).toEqual(exemplarCoherence(brand, { id: "e", label: "E" }, exemplar));
  });

  it("reports a missing exemplar profile as unavailable with nulls, never zero", () => {
    expect(exemplarCoherence(brand, { id: "e", label: "E" }, undefined)).toMatchObject({ status: "unavailable", sharedCount: null, jaccard: null });
    const view = coherenceView("RAW", brand, [{ exemplar: { id: "e", label: "E" }, profile: undefined }], null);
    expect(view).toMatchObject({ status: "insufficient_evidence", summary: null, band: null });
  });

  it("summarizes across exemplars with medians and consistently shared signals", () => {
    const view = coherenceView("RAW", brand, [
      { exemplar: { id: "e1", label: "E1" }, profile: exemplar },
      { exemplar: { id: "e2", label: "E2" }, profile: tagProfile("syn-ex3", "E3", [{ ns: "keyword:qloo", name: "a" }]) },
    ], null);
    expect(view.summary).toMatchObject({ exemplarsCompared: 2, sharedCountMin: 1, sharedCountMax: 2, sharedCountMedian: 1.5 });
    expect(view.summary!.consistentlyShared.map((s) => [s.label, s.exemplarCount])).toEqual([["Synthetic a", 2], ["Synthetic pay", 1]]);
  });

  it("uses the documented descriptive bands", () => {
    expect([0, 1, 2, 2.5, 5, 6].map(coherenceBand)).toEqual(["NONE", "SPARSE", "SPARSE", "SOME", "SOME", "SUBSTANTIAL"]);
  });
});
