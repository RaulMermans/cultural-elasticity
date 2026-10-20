import type { AgentAnalysisResult, AgentRunResponse } from "@cultural-elasticity/shared";
import { notFound } from "next/navigation";
import { postAgent } from "@/lib/backend";

// Developer-only debugging instrument for the Agentic Investigation Runtime: question → backend
// /api/agent/analyze (or /continue) → status, tool timeline, territories, representations,
// deterministic results, synthesis, limitations. Not a product page; never in production builds.
export const dynamic = "force-dynamic";

type Params = { [key: string]: string | string[] | undefined };
const one = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value)?.trim() || undefined;
const n = (value: number | null | undefined) => (value === null || value === undefined ? "—" : String(Number(value.toFixed(3))));

function Timeline({ response }: { response: AgentRunResponse }) {
  return (
    <table>
      <thead>
        <tr>
          <th>It.</th>
          <th>Tool</th>
          <th>Permission</th>
          <th>Status</th>
          <th>Qloo operations (correlation ids)</th>
          <th>Summary</th>
        </tr>
      </thead>
      <tbody>
        {response.trace.toolCalls.map((call) => (
          <tr key={call.id}>
            <td>{call.iteration}</td>
            <td>
              {call.tool}
              {call.skill && <div className="notice">{`${call.skill.id} v${call.skill.version}`}{call.expectedValue && ` · value ${call.expectedValue}`}</div>}
            </td>
            <td>{call.permission}</td>
            <td>{call.status}</td>
            <td>
              {call.qlooOperations.join(", ") || "—"}
              {call.correlationIds.length > 0 && <div className="notice">{call.correlationIds.join(" ")}</div>}
            </td>
            <td>{call.summary}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function Turns({ response }: { response: AgentRunResponse }) {
  return (
    <table>
      <thead>
        <tr>
          <th>It.</th>
          <th>Active skills (version)</th>
          <th>Tools / actions exposed</th>
          <th>Context</th>
          <th>Model attempts</th>
          <th>Decisions</th>
        </tr>
      </thead>
      <tbody>
        {response.trace.turns.map((t) => (
          <tr key={t.iteration}>
            <td>{t.iteration}</td>
            <td>{(t.skills ?? []).map((s) => `${s.id} v${s.version}`).join(", ") || "—"}</td>
            <td className="notice">{(t.toolsExposed ?? []).join(", ")}</td>
            <td>
              {t.contextChars ?? "—"} chars (~{t.contextTokensEstimate ?? "—"} tok)
              {t.usage && <div className="notice">provider: {t.usage.inputTokens} in / {t.usage.outputTokens} out</div>}
            </td>
            <td>
              {t.modelAttempts ?? 1}
              {t.repairReason && <div className="notice">repair: {t.repairReason}</div>}
            </td>
            <td>
              {t.decisions.map((d, i) => (
                <div key={i} className={d.accepted ? undefined : "notice"}>
                  {d.accepted ? "✓" : "✗"} {d.tool ?? d.action} {d.reasonSummary && `— ${d.reasonSummary}`} {d.rejection && `(${d.rejection})`}
                </div>
              ))}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function Quality({ result }: { result: AgentAnalysisResult }) {
  return (
    <table>
      <thead>
        <tr>
          <th>Territory</th>
          <th>Attempt</th>
          <th>Candidate</th>
          <th>Deterministic</th>
          <th>Model judgment (advisory)</th>
          <th>Final</th>
        </tr>
      </thead>
      <tbody>
        {result.trace.representationQuality.map((d, i) => (
          <tr key={i}>
            <td>{d.territoryKey}</td>
            <td>{d.attempt}</td>
            <td>{d.label}</td>
            <td>
              {d.deterministic.level}
              <div className="notice">{d.deterministic.reasons.join("; ")}</div>
            </td>
            <td>{d.modelAssessment ? `${d.modelAssessment.relevance}: ${d.modelAssessment.reason}` : "—"}</td>
            <td>
              {d.final}
              <div className="notice">{d.rule}</div>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function ComparisonSet({ result }: { result: AgentAnalysisResult }) {
  const cs = result.comparisonSetConstruction;
  return (
    <>
      <p className="notice">{cs.note}</p>
      <ul>
        {cs.proposed.map((p) => (
          <li key={p.key}>
            <strong>{p.label}</strong> ({p.role}, {p.source}) — {p.evidence}
          </li>
        ))}
      </ul>
      {cs.rejected.length > 0 && (
        <>
          <p>Rejected</p>
          <ul>
            {cs.rejected.map((r) => (
              <li key={r.key}>
                {r.label}: {r.stage} · {r.code} — {r.reason}
              </li>
            ))}
          </ul>
        </>
      )}
      <p>
        Diversity: {cs.diversity.assessment} — {cs.diversity.detail}
      </p>
      {cs.dedupDecisions.length > 0 && (
        <ul>
          {cs.dedupDecisions.map((d, i) => (
            <li key={i}>
              {d.a.label} / {d.b.label}: {d.verdict} ({d.layer}: {d.basis}) → {d.action}
              {d.modelJudgment && ` · model: ${d.modelJudgment.verdict} (${d.modelJudgment.applied ? "applied" : "not applied"}) — ${d.modelJudgment.reason}`}
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

function Territories({ result }: { result: AgentAnalysisResult }) {
  return (
    <table>
      <thead>
        <tr>
          <th>Territory</th>
          <th>Concept</th>
          <th>Representation</th>
          <th>Route</th>
          <th>Position</th>
          <th>Robustness</th>
          <th>Coherence (filtered)</th>
          <th>Conditioned</th>
          <th>Quality</th>
          <th>Class (provisional)</th>
        </tr>
      </thead>
      <tbody>
        {result.territories.map((t) => (
          <tr key={t.key}>
            <td>
              {t.label}
              <div className="notice">
                {t.role} · {t.origin}
              </div>
            </td>
            <td>{t.resolvedConcept ? `${t.resolvedConcept.label} (${t.resolvedConcept.id})` : "none"}</td>
            <td>
              {t.representation.strategy}
              <div className="notice">{t.representation.exemplars.map((e) => e.label).join(", ") || "no exemplars"}</div>
              {t.representation.rejectedExemplars.map((r) => (
                <div key={`${r.label}-${r.code}`} className="notice">
                  rejected {r.label}: {r.code}
                </div>
              ))}
            </td>
            <td>{t.analysisRoute}</td>
            <td>{t.relativePosition ? `${t.relativePosition.position ?? "—"} / ${t.relativePosition.of} (median ${n(t.relativePosition.medianPercentile)})` : t.capabilities.relativePosition}</td>
            <td>{t.robustness ? `${t.robustness.level} (spread ${n(t.robustness.percentileSpread)})` : t.capabilities.robustness}</td>
            <td>{t.coherence ? `median ${n(t.coherence.filteredSharedMedian)} · ${t.coherence.filteredBand ?? "—"}` : t.capabilities.coherence}</td>
            <td>{t.conditionedEvidence ? `${t.conditionedEvidence.support} (${t.conditionedEvidence.entityCount})` : t.capabilities.conditionedEvidence}</td>
            <td>{t.evidenceQuality?.level ?? "—"}</td>
            <td>{t.classification?.label ?? t.capabilities.classification}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export default async function DevAgentPage({ searchParams }: { searchParams: Promise<Params> }) {
  if (process.env.NODE_ENV === "production") notFound();
  const params = await searchParams;
  const query = one(params.q);
  const brand = one(params.brand);
  const territories = one(params.territories);
  const model = one(params.model) === "baseline" ? "baseline" : "auto";
  const runId = one(params.runId);
  const clarification = one(params.clarification);

  let outcome: Awaited<ReturnType<typeof postAgent>> | undefined;
  if (runId && clarification) outcome = await postAgent("/api/agent/continue", { runId, clarification, model });
  else if (query) {
    outcome = await postAgent("/api/agent/analyze", {
      query,
      model,
      ...(brand && { brand }),
      ...(territories !== undefined && { territories: territories.split(",").map((t) => t.trim()).filter(Boolean) }),
    });
  }

  return (
    <main className="dev">
      <h1>/dev/agent</h1>
      <p className="notice">
        Debugging instrument. A live run calls Qloo through the backend (spaced calls, minutes). Model &quot;auto&quot; needs ANTHROPIC_API_KEY on the backend; &quot;baseline&quot; is the deterministic reference policy, not an LLM.
      </p>
      <form method="get">
        <p>
          <label>
            Question <input name="q" defaultValue={query ?? ""} size={70} />
          </label>
        </p>
        <p>
          <label>
            Brand (optional) <input name="brand" defaultValue={brand ?? ""} />
          </label>{" "}
          <label>
            Territories, comma-separated (optional) <input name="territories" defaultValue={territories ?? ""} size={40} />
          </label>{" "}
          <label>
            Model{" "}
            <select name="model" defaultValue={model}>
              <option value="auto">auto (live model)</option>
              <option value="baseline">baseline (reference policy)</option>
            </select>
          </label>
        </p>
        <button type="submit">Run Investigation</button>
      </form>

      {outcome?.status === "unavailable" && <p data-status="unavailable">Backend unavailable.</p>}
      {outcome?.status === "rejected" && <pre data-status="unavailable">{outcome.detail}</pre>}
      {outcome?.status === "ok" && (
        <>
          <h2>
            Status: {outcome.response.status} · intent {outcome.response.trace.intent ?? "—"} · model {outcome.response.model.id} ({outcome.response.model.kind})
          </h2>
          <p>
            Iterations {outcome.response.metrics.agent_iterations} · Qloo calls {outcome.response.metrics.qloo_calls} · tool calls {outcome.response.metrics.tool_calls} · invalid actions {outcome.response.metrics.invalid_actions} · latency{" "}
            {outcome.response.metrics.latency_ms} ms
          </p>
          {outcome.response.status === "NEEDS_INPUT" ? (
            <form method="get">
              <p>
                <strong>{outcome.response.question}</strong> ({outcome.response.ambiguity})
              </p>
              <ul>
                {outcome.response.options.map((o) => (
                  <li key={o.id}>
                    {o.label} — {o.id}
                  </li>
                ))}
              </ul>
              <input type="hidden" name="runId" value={outcome.response.runId} />
              <input type="hidden" name="model" value={model} />
              <label>
                Answer <input name="clarification" size={50} />
              </label>{" "}
              <button type="submit">Continue</button>
            </form>
          ) : (
            <>
              <p>
                Brand: <strong>{(outcome.response as AgentAnalysisResult).brand?.label ?? "unresolved"}</strong> · evidence origin <strong>{(outcome.response as AgentAnalysisResult).evidenceOrigin}</strong> · final sufficiency{" "}
                {(outcome.response as AgentAnalysisResult).finalSufficiency}
              </p>
              <h3>Territories (deterministic results)</h3>
              <Territories result={outcome.response as AgentAnalysisResult} />
              <h3>Synthesis ({(outcome.response as AgentAnalysisResult).summary.source})</h3>
              <pre>{(outcome.response as AgentAnalysisResult).summary.text}</pre>
              {(outcome.response as AgentAnalysisResult).summary.claimValidation.violations.length > 0 && (
                <p className="notice">Rejected model claims: {(outcome.response as AgentAnalysisResult).summary.claimValidation.violations.join(" | ")}</p>
              )}
              <h3>Limitations</h3>
              <ul>
                {(outcome.response as AgentAnalysisResult).limitations.map((l) => (
                  <li key={`${l.code}-${l.detail}`}>
                    <strong>{l.code}</strong>: {l.detail}
                  </li>
                ))}
              </ul>
            </>
          )}
          {outcome.response.status !== "NEEDS_INPUT" && (
            <>
              <h3>Representation quality decisions</h3>
              <Quality result={outcome.response as AgentAnalysisResult} />
              <h3>Comparison-set construction and concept deduplication</h3>
              <ComparisonSet result={outcome.response as AgentAnalysisResult} />
              <h3>Skills used</h3>
              <p>{(outcome.response as AgentAnalysisResult).skillsUsed.map((s) => `${s.id} v${s.version}`).join(", ")}</p>
            </>
          )}
          <h3>Model turns (skills, exposure, context, repairs)</h3>
          <Turns response={outcome.response} />
          <h3>Budgets</h3>
          <p>
            Qloo {outcome.response.metrics.qloo_calls} / {outcome.response.trace.limits.maxQlooCalls} · iterations {outcome.response.metrics.agent_iterations} / {outcome.response.trace.limits.maxAgentIterations} · calls avoided {outcome.response.metrics.calls_avoided} · model cost{" "}
            {outcome.response.metrics.model_cost_usd ?? "n/a"}
          </p>
          <ul>
            {outcome.response.trace.skillUsage.map((u) => (
              <li key={u.skill.id}>
                {u.skill.id} v{u.skill.version}: {u.turns} turn(s), {u.qlooCalls} Qloo call(s), {u.toolCalls} tool call(s)
              </li>
            ))}
            {outcome.response.trace.earlyStops.map((e, i) => (
              <li key={`stop-${i}`} className="notice">
                it. {e.iteration} refused {e.tool} ({e.code}, {e.callsAvoided} call(s) avoided): {e.reason}
              </li>
            ))}
          </ul>
          <h3>Tool timeline</h3>
          <Timeline response={outcome.response} />
          <h3>Evidence sufficiency decisions (with next-action value)</h3>
          <ul>
            {outcome.response.trace.sufficiency.map((s, i) => (
              <li key={i}>
                it. {s.iteration}: {s.verdict}
                {s.materialGap === false && " · no material gap"} — {s.reasons.join("; ")}
                {s.nextActions && s.nextActions.length > 0 && <div className="notice">{s.nextActions.map((a) => `${a.action}${a.target ? `(${a.target})` : ""}: ${a.value}`).join(" · ")}</div>}
              </li>
            ))}
          </ul>
        </>
      )}
    </main>
  );
}
