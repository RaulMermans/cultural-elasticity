// SYNTHETIC inputs only: placeholder directions, jobs and responses. No Qloo evidence.
import assert from "node:assert/strict";
import test from "node:test";
import type { QueryResponse } from "@cultural-elasticity/shared";
import { BRAND_NODE, branchDirection, buildNetwork, canRetry, followUpContext, needsRefresh, inquiryState, layoutNetwork, type Inquiry } from "./research-network.ts";
import type { DirectionView } from "./research-view.ts";

const direction = (key: string) => ({ key, id: `t-${key}`, name: `SYNTHETIC ${key}` }) as DirectionView;
const inquiry = (jobId: string, parentId: string, extra: Partial<Inquiry> = {}): Inquiry => ({ jobId, token: "synthetic-token", parentId, origin: "question", question: `SYNTHETIC question ${jobId}`, status: "running", stageLabel: "", response: null, lost: false, createdAt: Number(jobId.replace(/\D/gu, "")) || 0, ...extra });
const response = (extra: Partial<QueryResponse>) => ({ queryId: "q", state: "INVESTIGATION_COMPLETED", reasons: [], interpretation: null, investigation: { runId: "run-1", reused: false, link: null, result: null }, territories: [], ...extra }) as unknown as QueryResponse;

test("the brand is the root, directions hang from it, and inquiries attach to the node they were asked from", () => {
  const nodes = buildNetwork("SYNTHETIC BRAND", [direction("a"), direction("b")], [inquiry("job1", "dir:a", { origin: "direction" }), inquiry("job2", "dir:missing")]);
  assert.deepEqual(nodes.map((node) => [node.id, node.parentId]), [
    [BRAND_NODE, null], ["dir:a", BRAND_NODE], ["dir:b", BRAND_NODE], ["inq:job1", "dir:a"], ["inq:job2", BRAND_NODE],
  ]);
});

test("a brand question joins the direction it names, or opens a new one; other territories become findings", () => {
  const territory = (name: string, key: string) => ({ name, investigationState: "INVESTIGATED", territoryKey: key, evidenceStatus: "PARTIAL_EVIDENCE", analysisRoute: null });
  const done = (names: ReturnType<typeof territory>[]) => ({ status: "completed", response: response({ territories: names } as Partial<QueryResponse>) });
  const nodes = buildNetwork("B", [direction("a")], [
    inquiry("job1", BRAND_NODE, done([territory("SYNTHETIC a", "k1")])),
    inquiry("job2", BRAND_NODE, done([territory("SYNTHETIC New", "k2"), territory("SYNTHETIC Ref", "k3")])),
    inquiry("job3", "dir:a", { ...done([territory("SYNTHETIC a", "k1")]), origin: "direction" }),
  ]);
  assert.equal(nodes.find((node) => node.id === "inq:job1")!.parentId, "dir:a");
  const opened = nodes.find((node) => node.id === "new:synthetic new")!;
  assert.deepEqual([opened.kind, opened.parentId, opened.status], ["direction", BRAND_NODE, "New direction"]);
  assert.equal(nodes.find((node) => node.id === "inq:job2")!.parentId, "new:synthetic new");
  const findings = nodes.filter((node) => node.kind === "finding");
  assert.deepEqual(findings.map((node) => [node.label, node.parentId, node.tone, node.runId]), [["SYNTHETIC Ref", "inq:job2", "partial", "run-1"]]);
  assert.equal(branchDirection(nodes, "find:job2:k3")!.id, "new:synthetic new");
});

test("inquiry state reads only the job and the validated response", () => {
  assert.equal(inquiryState(inquiry("j", BRAND_NODE)).tone, "running");
  assert.equal(inquiryState(inquiry("j", BRAND_NODE, { lost: true })).status, "No longer available");
  const refused = response({ state: "UNSUPPORTED_OPERATION", investigation: null });
  assert.equal(inquiryState(inquiry("j", BRAND_NODE, { status: "completed", response: refused })).status, "Not run");
  const assessed = response({ investigation: { runId: "r", reused: false, link: null, result: { status: "COMPLETE", hypothesisAssessment: { outcome: "WORTH_FURTHER_INVESTIGATION" } } } } as unknown as Partial<QueryResponse>);
  assert.deepEqual(inquiryState(inquiry("j", BRAND_NODE, { status: "completed", response: assessed })), { tone: "supported", status: "Worth pursuing" });
});

test("follow-ups carry the node's run and territory; nodes without a run start a new question", () => {
  const nodes = buildNetwork("B", [direction("a")], []);
  assert.equal(followUpContext(nodes[1]!), null);
  assert.deepEqual(followUpContext({ ...nodes[1]!, runId: "run-9", territoryKey: "k" }), { runId: "run-9", selectedTerritoryKey: "k" });
});

test("the radial layout puts the brand at the centre and is deterministic", () => {
  const nodes = buildNetwork("B", [direction("a"), direction("b"), direction("c")], [inquiry("job1", "dir:a")]);
  const first = layoutNetwork(nodes);
  assert.deepEqual(first.get(BRAND_NODE), { x: 0, y: 0 });
  assert.deepEqual([...layoutNetwork(nodes)], [...first]);
  const radius = (id: string) => Math.hypot(first.get(id)!.x, first.get(id)!.y);
  assert.ok(radius("inq:job1") > radius("dir:a"));
});

test("only failed, stopped or lost investigations without a kept result can be retried", () => {
  assert.equal(canRetry(inquiry("j1", BRAND_NODE)), false);
  assert.equal(canRetry(inquiry("j2", BRAND_NODE, { status: "failed" })), true);
  assert.equal(canRetry(inquiry("j3", BRAND_NODE, { status: "cancelled" })), true);
  assert.equal(canRetry(inquiry("j4", BRAND_NODE, { lost: true })), true);
  assert.equal(canRetry(inquiry("j5", BRAND_NODE, { status: "succeeded", response: response({ state: "NEEDS_CLARIFICATION", investigation: null } as never) })), false);
});

test("a finished answer kept in the browser stays readable when the server has let the job go", () => {
  const refused = response({ state: "UNSUPPORTED_OPERATION", investigation: null });
  const kept = inquiry("j6", BRAND_NODE, { status: "completed", response: refused, lost: true });
  assert.equal(inquiryState(kept).status, "Not run");
  assert.equal(canRetry(kept), false);
  assert.equal(needsRefresh(kept), false);
  assert.equal(needsRefresh(inquiry("j7", BRAND_NODE, { status: "completed", response: refused })), false);
  assert.equal(needsRefresh(inquiry("j8", BRAND_NODE)), true);
});
