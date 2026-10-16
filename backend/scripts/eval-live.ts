/**
 * `pnpm eval:live`: offline checks over LIVE and RECORDED fixtures. Makes no network request.
 * Its results describe captured live evidence; they are not a new live validation. For that, run
 * `pnpm feasibility:qloo`. Never mix these results with `pnpm eval:methodology` (synthetic).
 */
import { formatClassReport, runLiveEval, runRecordedEval } from "./live-harness.js";

const live = runLiveEval();
const recorded = runRecordedEval();
console.log(formatClassReport(live));
console.log("");
console.log(formatClassReport(recorded));
process.exit(live.passed && recorded.passed ? 0 : 1);
