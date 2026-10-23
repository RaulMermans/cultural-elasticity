import { runFunctionPoc } from "./function-poc.js";
import { syntheticInvestigationWorkflow } from "./official-workflow.js";

const fn = await runFunctionPoc();
console.log(JSON.stringify(fn, null, 2));
const wf = await syntheticInvestigationWorkflow({ query: "Where could a synthetic brand expand?", brand: "SYN-BRAND" });
console.log(JSON.stringify({ workflow: wf, compiler: "NOT_TESTED (this process is ordinary TypeScript)" }, null, 2));
