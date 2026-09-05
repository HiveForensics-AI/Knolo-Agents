import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import {
  assertNarrowAuthority,
  callableAgent,
  classifyFailure,
  compareSuites,
  formatAcsReport,
  createHarness,
  parseLockfile,
  scoreHarnessRun,
  scoreRecordedRun,
  staticEvidence,
  toolAwareAgent,
  memoryPackRegistry,
} from "../dist/index.js";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const srcRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../src");
const acsDir = resolve(root, "contracts/fixtures/harness/acs");

function loadSuite(id) {
  return JSON.parse(readFileSync(resolve(acsDir, `${id}.json`), "utf8"));
}

function walk(dir) {
  const files = [];
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) files.push(...walk(path));
    else if (path.endsWith(".ts")) files.push(path);
  }
  return files;
}

test("evaluateRun records contract, artifact, and task checks in order", async () => {
  const suite = loadSuite("knowledge-qa-v1");
  const { receipt, evaluation } = await (await createHarness({
    agent: callableAgent(async (_input, ctx) => {
      const cited = ctx.envelope.evidence.map(item => item.sourceId ?? item.id).join(" ");
      return `identify suspicious transactions and cite supporting evidence from ${cited}`;
    }),
    task: {
      objective: suite.task.objective,
      successCriteria: suite.task.successCriteria,
      prohibitedActions: suite.task.prohibitedActions,
      evidenceRequirements: suite.task.requiredEvidence,
    },
    evidence: staticEvidence([{ id: "e1", text: "ledger anomaly", sourceId: "ledger-pack", required: true }]),
    evaluators: suite,
    runId: "eval-order",
  })).run().then(async run => ({ receipt: run.receipt, evaluation: run.receipt.evaluationReceipt }));
  const phases = evaluation.checks.map(item => item.phase);
  assert.deepEqual([...new Set(phases)], ["contract", "artifact", "task"]);
  assert.equal(evaluation.passed, true);
  assert.equal(evaluation.judge, null);
  assert.equal(receipt.finalStatus, "succeeded");
});

test("optional semantic judge is recorded as a non-deterministic external effect", async () => {
  const { evaluationReceipt } = (await (await createHarness({
    agent: callableAgent(async () => "ok"),
    task: { objective: "x", successCriteria: ["ok"] },
    judge: async () => ({ kind: "external-effect", effect: "semantic-judge", deterministic: false, passed: true, model: "host-judge", notes: "looks good" }),
    runId: "eval-judge",
  })).run()).receipt;
  assert.equal(evaluationReceipt.judge.kind, "external-effect");
  assert.equal(evaluationReceipt.judge.deterministic, false);
  assert.equal(evaluationReceipt.judge.passed, true);
  assert.ok(evaluationReceipt.checks.some(item => item.phase === "judge"));
});

test("timeout failures retry then succeed", async () => {
  let attempts = 0;
  const { result, receipt } = await (await createHarness({
    agent: callableAgent(async () => {
      attempts += 1;
      if (attempts === 1) throw new Error("tool_timeout");
      return "complete investigation";
    }),
    task: { objective: "recover", successCriteria: ["complete investigation"] },
    recovery: { maxRetries: 1 },
    runId: "eval-retry",
  })).run();
  assert.equal(attempts, 2);
  assert.equal(result.status, "succeeded");
  assert.ok(receipt.recoveryEvents.some(item => item.strategy === "retry" && item.class === "timeout"));
});

test("policy failures fail closed and are not retried", async () => {
  let attempts = 0;
  const { receipt } = await (await createHarness({
    agent: callableAgent(async () => {
      attempts += 1;
      throw new Error("tool is prohibited by task policy: wire_transfer");
    }),
    task: { objective: "x", successCriteria: ["x"], prohibitedActions: ["wire_transfer"] },
    recovery: true,
    runId: "eval-policy",
  })).run();
  assert.equal(attempts, 1);
  assert.equal(receipt.finalStatus, "failed");
  assert.equal(classifyFailure({ status: "failed", output: null, error: "tool is prohibited by task policy: wire_transfer" }), "policy");
  assert.equal(receipt.recoveryEvents.length, 0);
});

test("exhausted recovery becomes a graceful partial", async () => {
  const { result, receipt } = await (await createHarness({
    agent: callableAgent(async () => {
      throw new Error("tool exploded");
    }),
    task: { objective: "x", successCriteria: ["done"] },
    recovery: { maxRetries: 1, strategies: ["retry", "graceful-partial"] },
    runId: "eval-partial",
  })).run();
  assert.equal(result.status, "partial");
  assert.ok(receipt.recoveryEvents.some(item => item.strategy === "graceful-partial"));
});

test("handoff escalation fails closed", () => {
  const parent = { capabilities: ["ledger.read"], namespaces: ["examples.ledger"], maxSteps: 4, maxCostMicros: 10 };
  const pack = parent;
  const child = { capabilities: ["ledger.read", "payments.send"], namespaces: ["examples.ledger"], maxSteps: 4, maxCostMicros: 10 };
  assert.throws(() => assertNarrowAuthority(child, parent, pack), /handoff authority escalation/);
});

test("harnessed ACS mean beats the dummy baseline by at least 10%", async () => {
  const knowledge = loadSuite("knowledge-qa-v1");
  const tools = loadSuite("tool-workflow-v1");
  const recovery = loadSuite("failure-recovery-v1");
  let recoveries = 0;

  const knowledgeRun = await (await createHarness({
    agent: callableAgent(async (_input, ctx) => `identify suspicious transactions and cite supporting evidence from ${ctx.envelope.evidence.map(item => item.sourceId).join(" ")}`),
    task: {
      objective: knowledge.task.objective,
      successCriteria: knowledge.task.successCriteria,
      prohibitedActions: knowledge.task.prohibitedActions,
      evidenceRequirements: knowledge.task.requiredEvidence,
    },
    evidence: staticEvidence([{ id: "e1", text: "anomaly", sourceId: "ledger-pack", required: true }]),
    evaluators: knowledge,
    runId: "acs-knowledge",
  })).run();

  const toolsRun = await (await createHarness({
    agent: toolAwareAgent({
      tools: { search_ledger: async () => ({ hits: 1 }) },
      invoke: async (_input, _ctx, bridge) => {
        await bridge.call("search_ledger", {});
        return "return structured findings use search_ledger";
      },
    }),
    task: {
      objective: tools.task.objective,
      successCriteria: tools.task.successCriteria,
      prohibitedActions: tools.task.prohibitedActions,
      requiredCapabilities: ["tools"],
    },
    evaluators: tools,
    runId: "acs-tools",
  })).run();

  const recoveryRun = await (await createHarness({
    agent: callableAgent(async () => {
      recoveries += 1;
      if (recoveries === 1) throw new Error("tool_timeout");
      return "complete investigation";
    }),
    task: {
      objective: recovery.task.objective,
      successCriteria: recovery.task.successCriteria,
      prohibitedActions: recovery.task.prohibitedActions,
    },
    evaluators: recovery,
    recovery: { maxRetries: 1, strategies: ["retry"] },
    runId: "acs-recovery",
  })).run();

  const report = compareSuites([
    { suite: knowledge, harnessed: knowledgeRun.acs },
    { suite: tools, harnessed: toolsRun.acs },
    { suite: recovery, harnessed: recoveryRun.acs },
  ]);
  assert.equal(report.baselineMean, 48.33);
  assert.equal(report.target, 10);
  assert.ok(report.meetsTarget, `relative uplift ${report.relativeUplift}% should be >= 10%`);
  assert.ok(report.harnessMean > report.baselineMean);
  assert.equal(knowledgeRun.acs.metrics.grounding, 100);
  assert.equal(toolsRun.acs.metrics.toolCorrectness, 100);
  assert.equal(toolsRun.acs.metrics.policy, 100);
  assert.equal(recoveryRun.acs.metrics.recovery, 100);

  const markdown = formatAcsReport(report);
  assert.match(markdown, /^# ACS harness report/m);
  assert.match(markdown, /Target relative uplift: 10%/);
  assert.match(markdown, /knowledge-qa-v1/);
  assert.match(markdown, /Meets target: yes/);
});

test("offline suite runs from pinned cache without network", async () => {
  const suite = loadSuite("offline-v1");
  const lockfile = parseLockfile(readFileSync(resolve(root, "contracts/fixtures/harness/registry/knolo.lock.json"), "utf8"));
  const bytes = new Uint8Array(readFileSync(resolve(root, "contracts/fixtures/harness/registry/pack-bytes.txt")));
  const manifest = JSON.parse(readFileSync(resolve(root, "contracts/fixtures/harness/registry/manifest-v1.json"), "utf8"));
  const registry = memoryPackRegistry({ origin: lockfile.registry, packs: [{ manifest, bytes }], lockfile });
  const { result, acs } = await (await createHarness({
    agent: callableAgent(async () => "pinned cache hit"),
    task: { objective: suite.task.objective, successCriteria: suite.task.successCriteria },
    registry,
    lockfile,
    offline: true,
    evaluators: suite,
    runId: "acs-offline",
  })).run();
  assert.equal(result.status, "succeeded");
  assert.ok(scoreHarnessRun(suite, { output: "pinned cache hit", status: "succeeded" }).composite > scoreRecordedRun(suite, suite.baseline).composite);
  assert.ok(acs.composite > 50);
});

test("evaluation and recovery modules do not import icp", () => {
  for (const dir of ["evaluation", "recovery"]) {
    for (const file of walk(join(srcRoot, dir))) {
      const text = readFileSync(file, "utf8");
      assert.equal(/from ["']\.\.\/icp/.test(text), false, file);
      assert.equal(/IcpAgentRuntimeClient/.test(text), false, file);
    }
  }
});
