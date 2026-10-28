/** SYNTHETIC names: suggestions narrow as you type, from local research only. */
import assert from "node:assert/strict";
import test from "node:test";
import { brandSuggestions, type SuggestionSource } from "./brand-suggestions.ts";

const s = (label: string, kind: "library" | "recorded", at: number): SuggestionSource<string> => ({ label, detail: "", kind, value: label, at });
const sources = [s("Synthé Velo", "library", 2), s("Velo Syn", "recorded", 1), s("Larkspur Synthetic", "library", 3), s("synthe velo", "recorded", 5)];

test("prefix matches come first, accents and case are ignored, and each brand appears once", () => {
  assert.deepEqual(brandSuggestions("synthe", sources).map((item) => [item.label, item.kind]), [["Synthé Velo", "library"], ["Larkspur Synthetic", "library"]]);
  assert.deepEqual(brandSuggestions("VELO", sources).map((item) => item.label), ["Velo Syn", "Synthé Velo"]);
  assert.deepEqual(brandSuggestions("zzz", sources), []);
});

test("an empty query lists your research first, newest first", () => {
  assert.deepEqual(brandSuggestions("", sources).map((item) => item.label), ["Larkspur Synthetic", "Synthé Velo", "Velo Syn"]);
});
