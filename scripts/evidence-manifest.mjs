#!/usr/bin/env node
/**
 * Sprint 9O evidence manifest. Reads the case directories under an evidence root (each one is a hosted run's
 * E2E_EVIDENCE_DIR: live-ledger.json, jobs/, results/, reports/, screenshots, exports) and writes manifest.json, which
 * connects every artefact to its pre-registered case, model, engine revision and checksum. It reads files only and
 * never calls a provider.
 *   node scripts/evidence-manifest.mjs docs/sprint-9o/evidence --revision <deployed sha> [--ledger-before q,c --ledger-after q,c]
 * It refuses to write if any file contains something that looks like a credential.
 */
import { createHash } from "node:crypto";
import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";

const root = process.argv[2];
if (!root) throw new Error("usage: evidence-manifest.mjs <evidence root> --revision <sha>");
const arg = (name) => {
  const i = process.argv.indexOf(name);
  return i > 0 ? process.argv[i + 1] : null;
};
const revision = arg("--revision");
if (!revision) throw new Error("--revision <deployed sha> is required (read it from verify-production, not from the local checkout)");

const SECRET = /(sk-ant-[A-Za-z0-9_-]{10,}|x-ce-(operator|paid-operator)["':\s]+[a-f0-9]{32,}|accessToken["':\s]+[A-Za-z0-9_-]{16,}|postgres(ql)?:\/\/[^\s"]+)/u;
const walk = (dir) => readdirSync(dir).flatMap((name) => (statSync(join(dir, name)).isDirectory() ? walk(join(dir, name)) : [join(dir, name)]));
const json = (path) => {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return null;
  }
};

const cases = [];
const leaks = [];
for (const name of readdirSync(root).filter((d) => statSync(join(root, d)).isDirectory()).sort()) {
  const dir = join(root, name);
  const files = walk(dir).sort();
  for (const f of files) if (/\.(json|html|txt|md)$/u.test(f) && SECRET.test(readFileSync(f, "utf8"))) leaks.push(relative(root, f));
  const ledger = json(join(dir, "live-ledger.json"));
  const results = files.filter((f) => f.includes(`${join(dir, "results")}/`) && f.endsWith(".json")).map((f) => {
    const r = json(f) ?? {};
    return {
      file: relative(root, f),
      runId: r.runId ?? null,
      status: r.status ?? null,
      evidenceOrigin: r.evidenceOrigin ?? null,
      model: r.model ?? null,
      feasibility: r.comparisonFeasibility ? { rulesVersion: r.comparisonFeasibility.rulesVersion, status: r.comparisonFeasibility.status, blocker: r.comparisonFeasibility.blocker?.code ?? null } : null,
      qlooCalls: r.metrics?.qloo_calls ?? null,
      iterations: r.metrics?.agent_iterations ?? null,
      latencyMs: r.metrics?.latency_ms ?? null,
      territories: (r.territories ?? []).map((t) => ({ key: t.key, role: t.role, route: t.analysisRoute ?? null, classification: t.classification ?? null })),
    };
  });
  cases.push({
    directory: name,
    caseId: ledger?.caseId ?? null,
    brand: ledger?.brand ?? null,
    question: ledger?.question ?? null,
    started: ledger?.ledger?.[0]?.at ?? null,
    ended: ledger?.ledger?.at(-1)?.at ?? null,
    completed: Boolean(ledger?.ledger?.some((s) => s.step === "done")),
    results,
    artefacts: files.map((f) => ({ path: relative(root, f), bytes: statSync(f).size, sha256: createHash("sha256").update(readFileSync(f)).digest("hex") })),
  });
}
if (leaks.length) {
  console.error(`REFUSED: possible credential in ${leaks.join(", ")}`);
  process.exit(1);
}
const pair = (v) => (v ? Object.fromEntries(v.split(",").map((x, i) => [i === 0 ? "qlooCalls" : "modelCents", Number(x)])) : null);
const manifest = {
  schema: "ce-evidence-manifest/1",
  environment: "production (live Qloo hackathon host + Claude Haiku)",
  deployedRevision: revision,
  ledger: { before: pair(arg("--ledger-before")), after: pair(arg("--ledger-after")), source: "/ops/status runLedger" },
  generatedAt: new Date().toISOString(),
  cases,
};
writeFileSync(join(root, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
console.log(`manifest.json: ${cases.length} case(s), ${cases.reduce((n, c) => n + c.artefacts.length, 0)} artefact(s)`);
