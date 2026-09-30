import { assertFlowCheckTarget } from "./flow-check-target.mjs";

try { assertFlowCheckTarget(); }
catch (error) {
  process.stderr.write(`${error.message}\n`);
  process.exit(1);
}
