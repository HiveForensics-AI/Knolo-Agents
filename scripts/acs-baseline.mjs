#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { meanComposite, scoreRecordedRun } from "../packages/agents/dist/evaluation/index.js";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const ids = ["knowledge-qa-v1", "tool-workflow-v1", "failure-recovery-v1"];
const scores = ids.map(id => {
  const suite = JSON.parse(readFileSync(resolve(root, "contracts/fixtures/harness/acs", `${id}.json`), "utf8"));
  return scoreRecordedRun(suite, suite.baseline);
});
const report = { version: 1, kind: "acs-baseline-report", agent: "dummy-callable", suites: scores.map(score => ({ id: score.suiteId, composite: score.composite, metrics: score.metrics })), meanComposite: meanComposite(scores) };
console.log(JSON.stringify(report, null, 2));
