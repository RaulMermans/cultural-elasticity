/**
 * Evidence quality: is there enough well-formed evidence to support analysis?
 *
 * This is NOT confidence in a business outcome, and there is no percentage. Each indicator is a
 * categorical level with its reasons. The optional overall classification follows one explicit rule
 * (OVERALL_RULE) over the core indicators plus comparison validity. Absent optional evidence
 * (audience, ranking, bridges) is reported as `unavailable` and never lowers the overall level,
 * because missing evidence is not negative evidence. Present evidence whose comparability claims
 * fail verification does cap the level at MEDIUM.
 */
import type { EvidenceQuality, QualityIndicator, QualityLevel } from "@cultural-elasticity/shared";
import { compareNumeric, verifyConditionedScope, verifyRankingScope } from "./comparability.js";
import { hasCorrelation } from "./provenance.js";
import type { BridgeEvidence, CulturalProfile, EvidencePacket, Limitation, ProvenanceRef } from "./schema.js";

export const OVERALL_RULE =
  "LOW if any core indicator (resolution, profileCoverage, provenance) is insufficient; HIGH if all core indicators are good " +
  "and no comparison requested by the evidence had to be refused (comparisonValidity is not limited); otherwise MEDIUM. " +
  "Absent optional evidence (audience, ranking, bridges, conditioned entities) never lowers the level.";

const CORE = ["resolution", "profileCoverage", "provenance"] as const;

/**
 * Bridge evidence counts as observed when it has signals, or when it is an empty result that traces
 * to a call. An empty, provenance-free bridge cannot be told apart from "not collected".
 */
export function isObservedBridge(bridge: BridgeEvidence): boolean {
  return bridge.signals.length > 0 || bridge.provenance.length > 0;
}

export function assessEvidenceQuality(packet: EvidencePacket): EvidenceQuality {
  const limitations: Limitation[] = [];
  const indicators: EvidenceQuality["indicators"] = {
    resolution: assessResolution(packet, limitations),
    profileCoverage: assessProfileCoverage(packet, limitations),
    numericEvidence: assessNumericEvidence(packet),
    provenance: assessProvenance(packet, limitations),
    comparisonValidity: assessComparisonValidity(packet, limitations),
    audienceSemantics: assessAudienceSemantics(packet, limitations),
    bridgeEvidence: assessBridgeEvidence(packet, limitations),
    conditionedEvidence: assessConditionedEvidence(packet),
  };

  const core = CORE.map((name) => [name, indicators[name].level] as const);
  // Absent evidence is neutral, but present evidence that contradicts its own comparability claims is not.
  const refused = indicators.comparisonValidity.level === "limited";
  const level = core.some(([, l]) => l === "insufficient") ? "LOW" : core.every(([, l]) => l === "good") && !refused ? "HIGH" : "MEDIUM";
  const drivers = core.filter(([, l]) => l !== "good").map(([name, l]) => `${name}: ${l}`);
  if (refused) drivers.push("comparisonValidity: limited");
  return { indicators, overall: { level, rule: OVERALL_RULE, drivers }, limitations };
}

function indicator(level: QualityLevel, reasons: string[] = []): QualityIndicator {
  return { level, reasons };
}

function assessResolution(packet: EvidencePacket, limitations: Limitation[]): QualityIndicator {
  const reasons: string[] = [];
  for (const [role, profile] of [["brand", packet.brand], ["target", packet.target]] as const) {
    if (profile.subject.resolution !== "confirmed") {
      reasons.push(`${role} subject resolution is ${profile.subject.resolution}`);
      limitations.push({ code: `${role.toUpperCase()}_RESOLUTION_${profile.subject.resolution.toUpperCase()}`, detail: `${role} subject "${profile.subject.label}" is not a confirmed resolution` });
    }
  }
  return indicator(reasons.length === 0 ? "good" : "limited", reasons);
}

function assessProfileCoverage(packet: EvidencePacket, limitations: Limitation[]): QualityIndicator {
  const reasons: string[] = [];
  let level: QualityLevel = "good";
  for (const [role, profile] of [["brand", packet.brand], ["target", packet.target]] as const) {
    const ROLE = role.toUpperCase();
    if (profile.signals.length === 0) {
      level = "insufficient";
      reasons.push(`${role} profile is empty`);
      limitations.push({ code: `${ROLE}_PROFILE_EMPTY`, detail: `${role} profile has no signals; overlap ratios cannot be computed` });
    } else if (profile.truncated === true) {
      if (level === "good") level = "limited";
      reasons.push(`${role} profile is truncated`);
      limitations.push({ code: `${ROLE}_PROFILE_TRUNCATED`, detail: `${role} profile is a truncated top-N list; overlap describes the observed representation only` });
    } else if (profile.truncated === undefined) {
      if (level === "good") level = "limited";
      reasons.push(`${role} profile truncation is unknown`);
      limitations.push({ code: `${ROLE}_TRUNCATION_UNKNOWN`, detail: `whether the ${role} profile is complete is not stated` });
    }
  }
  return indicator(level, reasons);
}

function assessNumericEvidence(packet: EvidencePacket): QualityIndicator {
  const signals = [...packet.brand.signals, ...packet.target.signals];
  if (signals.length === 0) return indicator("not_applicable", ["no signals"]);
  const numeric = signals.filter((signal) => signal.numeric !== undefined).length;
  const reason = `${numeric} of ${signals.length} profile signals carry a numeric value`;
  if (numeric === signals.length) return indicator("good", [reason]);
  return indicator(numeric === 0 ? "unavailable" : "limited", [reason]);
}

function assessProvenance(packet: EvidencePacket, limitations: Limitation[]): QualityIndicator {
  const items: { label: string; provenance: readonly ProvenanceRef[] }[] = [
    { label: "packet", provenance: packet.provenance },
    { label: "brand subject", provenance: packet.brand.subject.provenance },
    { label: "target subject", provenance: packet.target.subject.provenance },
    ...profileItems("brand", packet.brand),
    ...profileItems("target", packet.target),
    ...(packet.ranking?.candidates ?? []).map((candidate) => ({ label: `ranking candidate "${candidate.id}"`, provenance: candidate.provenance })),
    ...(packet.audience?.interpretableMetrics ?? []).map((metric) => ({ label: `audience metric "${metric.id}"`, provenance: metric.provenance })),
    ...(packet.bridges ?? []).flatMap((bridge, index) => bridge.signals.map((signal) => ({ label: `bridge #${index + 1} signal "${signal.id}"`, provenance: signal.provenance }))),
    ...(packet.conditionedEntities ?? []).flatMap((evidence) =>
      evidence.entities.length === 0
        ? [{ label: `conditioned ${evidence.territory.id} (empty result)`, provenance: evidence.provenance }]
        : evidence.entities.map((entity) => ({ label: `conditioned ${evidence.territory.id} entity "${entity.id}"`, provenance: entity.provenance })),
    ),
  ];
  const missing = items.filter((item) => item.provenance.length === 0).map((item) => item.label);
  const uncorrelated = items.filter((item) => item.provenance.length > 0 && !hasCorrelation(item.provenance)).map((item) => item.label);

  const reasons: string[] = [];
  if (missing.length > 0) {
    reasons.push(`${missing.length} of ${items.length} evidence items have no provenance`);
    limitations.push({ code: "MISSING_PROVENANCE", detail: `no provenance for: ${summarize(missing)}` });
  }
  if (uncorrelated.length > 0) {
    reasons.push(`${uncorrelated.length} of ${items.length} evidence items have provenance without a correlation id`);
    limitations.push({ code: "MISSING_CORRELATION_ID", detail: `provenance without a correlation id for: ${summarize(uncorrelated)}` });
  }
  return indicator(missing.length > 0 ? "insufficient" : uncorrelated.length > 0 ? "limited" : "good", reasons);
}

function profileItems(role: string, profile: CulturalProfile) {
  return profile.signals.map((signal) => ({ label: `${role} signal "${signal.id}"`, provenance: signal.provenance }));
}

function assessComparisonValidity(packet: EvidencePacket, limitations: Limitation[]): QualityIndicator {
  const reasons: string[] = [];
  let attempted = 0;
  let refused = 0;

  const targetById = new Map(packet.target.signals.map((signal) => [signal.id, signal]));
  for (const brandSignal of packet.brand.signals) {
    const targetSignal = targetById.get(brandSignal.id);
    if (!targetSignal?.numeric || !brandSignal.numeric) continue;
    attempted += 1;
    const result = compareNumeric(
      { numeric: brandSignal.numeric, provenance: brandSignal.provenance },
      { numeric: targetSignal.numeric, provenance: targetSignal.provenance },
      "cross_profile",
    );
    if (!result.comparable) {
      refused += 1;
      if (refused === 1) reasons.push(`brand/target values for shared signals are not comparable: ${result.reason}`);
    }
  }
  if (refused > 0) {
    limitations.push({ code: "CROSS_PROFILE_VALUES_NOT_COMPARABLE", detail: `${refused} of ${attempted} shared signals carry values that may not be compared across profiles` });
  }

  if (packet.ranking) {
    attempted += 1;
    const scope = verifyRankingScope(packet.ranking);
    if (!scope.verified) {
      refused += 1;
      reasons.push(`ranking scope unverified: ${scope.reason}`);
      limitations.push({ code: "RANKING_SCOPE_UNVERIFIED", detail: scope.reason });
    }
  }

  for (const evidence of packet.conditionedEntities ?? []) {
    attempted += 1;
    const scope = verifyConditionedScope(evidence);
    if (!scope.verified) {
      refused += 1;
      reasons.push(`conditioned evidence for ${evidence.territory.id} unverified: ${scope.reason}`);
      limitations.push({ code: "CONDITIONED_SCOPE_UNVERIFIED", detail: `${evidence.territory.id}: ${scope.reason}` });
    }
  }

  if (attempted === 0) return indicator("not_applicable", ["no numeric comparisons were requested by the evidence"]);
  return indicator(refused === 0 ? "good" : "limited", reasons);
}

function assessAudienceSemantics(packet: EvidencePacket, limitations: Limitation[]): QualityIndicator {
  if (!packet.audience) return indicator("unavailable", ["no audience evidence"]);
  const directional = packet.audience.interpretableMetrics.filter((metric) => metric.direction !== "neutral").length;
  if (directional > 0) return indicator("good", [`${directional} audience metric(s) have declared direction`]);
  limitations.push({ code: "AUDIENCE_SEMANTICS_UNVERIFIED", detail: "audience evidence has no metric with declared direction; it is kept as opaque evidence only" });
  return indicator("limited", ["audience evidence contains only opaque fields or neutral metrics"]);
}

function assessBridgeEvidence(packet: EvidencePacket, limitations: Limitation[]): QualityIndicator {
  const bridges = packet.bridges ?? [];
  const unverifiable = bridges.filter((bridge) => !isObservedBridge(bridge)).length;
  if (unverifiable > 0) {
    limitations.push({ code: "BRIDGE_EVIDENCE_UNVERIFIABLE", detail: `${unverifiable} empty bridge evidence item(s) carry no provenance and are treated as not collected` });
  }
  const observed = bridges.length - unverifiable;
  if (observed === 0) return indicator("unavailable", ["no observed bridge evidence"]);
  return indicator("good", [`${observed} observed bridge evidence item(s)`]);
}

function assessConditionedEvidence(packet: EvidencePacket): QualityIndicator {
  const items = packet.conditionedEntities ?? [];
  if (items.length === 0) return indicator("unavailable", ["no brand-conditioned territory evidence"]);
  const unverified = items.filter((evidence) => !verifyConditionedScope(evidence).verified).length;
  const empty = items.filter((evidence) => evidence.entities.length === 0).length;
  const reasons = [`${items.length} conditioned list(s); ${empty} observed empty`];
  if (unverified > 0) return indicator("limited", [...reasons, `${unverified} list(s) do not trace to a single call`]);
  return indicator("good", reasons);
}

function summarize(labels: string[]): string {
  return labels.length <= 5 ? labels.join(", ") : `${labels.slice(0, 5).join(", ")} and ${labels.length - 5} more`;
}
