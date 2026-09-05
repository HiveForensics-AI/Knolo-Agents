import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { meanComposite, scoreRecordedRun } from "../dist/evaluation/index.js";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const suiteIds = ["knowledge-qa-v1", "tool-workflow-v1", "failure-recovery-v1"];

function loadSuite(id) {
  return JSON.parse(readFileSync(resolve(root, "contracts/fixtures/harness/acs", `${id}.json`), "utf8"));
}

test("ACS baseline scores three dummy-agent suites deterministically", () => {
  const scores = suiteIds.map(id => {
    const suite = loadSuite(id);
    return scoreRecordedRun(suite, suite.baseline);
  });
  assert.deepEqual(scores.map(score => ({ id: score.suiteId, composite: score.composite })), [
    { id: "knowledge-qa-v1", composite: 50 },
    { id: "tool-workflow-v1", composite: 40 },
    { id: "failure-recovery-v1", composite: 55 },
  ]);
  assert.equal(meanComposite(scores), 48.33);
});

test("ACS rewards cited evidence and punishes prohibited tools", () => {
  const knowledge = loadSuite("knowledge-qa-v1");
  const improved = scoreRecordedRun(knowledge, {
    output: "identify suspicious transactions and cite supporting evidence from ledger-pack",
    toolCalls: [],
    status: "succeeded",
    tokens: 80,
  });
  assert.equal(improved.metrics.taskSuccess, 100);
  assert.equal(improved.metrics.grounding, 100);
  assert.ok(improved.composite > 50);

  const tools = loadSuite("tool-workflow-v1");
  const allowed = scoreRecordedRun(tools, {
    output: "return structured findings",
    toolCalls: ["search_ledger"],
    status: "succeeded",
    tokens: 100,
  });
  assert.equal(allowed.metrics.toolCorrectness, 100);
  assert.equal(allowed.metrics.policy, 100);
});
