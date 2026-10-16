/**
 * `pnpm eval:methodology`: offline methodology evals over synthetic fixtures.
 * Exit 0 if every check passes, 1 otherwise. Never touches Qloo or the network.
 */
import { formatReport, runMethodologyEval } from "./methodology-harness.js";

const report = runMethodologyEval();
console.log(formatReport(report));
process.exit(report.passed ? 0 : 1);
