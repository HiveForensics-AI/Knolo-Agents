import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { createHarness, knoloMcpBridge } from "../dist/index.js";
import { grokBuildAgent } from "../../../examples/adapters/grok-build/grok-build-agent.mjs";
import { grokAgent } from "../../../examples/adapters/grok/grok-agent.mjs";
import { wrapIcpCanister } from "../../../examples/adapters/icp/harness-wrap.mjs";
import { openClawAgent, openClawHttpFallback, openClawPlugin, OPENCLAW_PLUGIN_API } from "../../../examples/adapters/openclaw/plugin.mjs";
import { sharedHarnessOptions } from "../../../examples/adapters/shared/contracts.mjs";
import { loadVendorFixture, recordedComplete } from "../../../examples/adapters/shared/recorded.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const dummyTask = JSON.parse(readFileSync(resolve(root, "contracts/fixtures/harness/task-dummy-v1.json"), "utf8"));

test("Grok Build, Grok, and OpenClaw examples consume the same Task / Context / Skill contracts", async () => {
  const grokBuild = await (await createHarness(sharedHarnessOptions(
    grokBuildAgent({ complete: recordedComplete(loadVendorFixture("grok-chat-v1.json").turns), tools: "mcp", mcp: knoloMcpBridge() }),
    { runId: "vendor-grok-build" },
  ))).run();
  const grok = await (await createHarness(sharedHarnessOptions(
    grokAgent({ complete: recordedComplete(loadVendorFixture("grok-chat-v1.json").turns), tools: "mcp", mcp: knoloMcpBridge() }),
    { runId: "vendor-grok" },
  ))).run();
  const openclaw = await (await createHarness(sharedHarnessOptions(
    openClawAgent({ complete: async () => loadVendorFixture("openclaw-end-v1.json"), plugin: openClawPlugin({ mcp: true }) }),
    { runId: "vendor-openclaw" },
  ))).run();

  for (const run of [grokBuild, grok, openclaw]) {
    assert.equal(run.receipt.evaluationReceipt.passed, true);
    assert.deepEqual(run.receipt.evaluationReceipt.successCriteriaMatched, dummyTask.successCriteria);
    assert.equal(run.envelope.task.objective, dummyTask.objective);
    assert.equal(run.envelope.evidence.some(item => item.sourceId === "ledger-pack"), true);
    assert.equal(run.envelope.skills.some(item => item.id === "ledger-review"), true);
    assert.match(run.receipt.harnessDependencyRoot, /^knolo\.harness\.dependencies\.v1:/);
    assert.equal(run.skills?.selected.some(item => item.id === "ledger-review"), true);
    assert.equal(run.acquisition?.registry, "disabled");
  }
  assert.equal(grokBuild.result.toolCalls.includes("knolo.retrieve"), true);
  assert.equal(grok.result.toolCalls.includes("knolo.retrieve"), true);
  assert.equal(grokBuild.receipt.toolReceipts.includes("knolo.retrieve"), true);
  assert.equal(grokBuild.receipt.agentDescriptorHash.startsWith("agent:"), true);
  assert.deepEqual(OPENCLAW_PLUGIN_API.hooks, ["before_prompt_build", "before_tool_call", "agent_end"]);
  assert.deepEqual((openclaw.result.events ?? []).map(item => item.hook), ["before_prompt_build", "agent_end"]);
});

test("OpenClaw plugin denies prohibited tools and HTTP fallback stays L0", async () => {
  const denied = await (await createHarness(sharedHarnessOptions(
    openClawAgent({
      complete: async () => ({ output: "attempted wire", toolCalls: [{ name: "wire_transfer" }] }),
      plugin: openClawPlugin(),
    }),
    { runId: "vendor-openclaw-deny" },
  ))).run();
  assert.equal(denied.result.status, "failed");
  assert.match(denied.result.error, /prohibited/);

  const http = await (await createHarness(sharedHarnessOptions(
    openClawHttpFallback({
      url: "https://openclaw.example.invalid/run",
      fetch: async () => new Response(
        JSON.stringify({ output: "identify suspicious transactions and cite supporting evidence; do not perform irreversible actions" }),
        { status: 200 },
      ),
    }),
    { runId: "vendor-openclaw-http" },
  ))).run();
  assert.equal(http.result.status, "succeeded");
  assert.equal(http.receipt.evaluationReceipt.passed, true);
  assert.equal(http.result.toolCalls, undefined);
});

test("ICP harness wrap uses icpAgent() and the same shared task", async () => {
  const session = await wrapIcpCanister({
    inspect: async () => ({
      ok: true,
      engine: "icp",
      graph_loaded: true,
      graph_id: [],
      graph_hash: [],
      implementation_id: [],
      execution_count: 0n,
      capabilities: [],
      limitations: ["fake"],
      message: "ok",
      schema_version: 1,
      handoff_count: 0n,
    }),
    start_execution: async (executionId) => ({
      ok: true,
      execution_id: executionId,
      status: { kind: "terminated", detail: "done" },
      steps: 1n,
      tokens: 0n,
      cost_micros: 0n,
      state_json: JSON.stringify("identify suspicious transactions and cite supporting evidence; do not perform irreversible actions"),
      event_count: 1n,
      message: "ok",
    }),
  }, { runId: "vendor-icp" });
  const { result, receipt, envelope } = await session.run();
  assert.equal(result.status, "succeeded");
  assert.equal(receipt.finalStatus, "succeeded");
  assert.equal(envelope.task.objective, dummyTask.objective);
  assert.equal(receipt.evaluationReceipt.passed, true);
});

test("live vendor smoke is env-flagged and never required", async t => {
  const flag = process.env.KNOLO_VENDOR_SMOKE ?? "";
  if (!flag) {
    t.skip("KNOLO_VENDOR_SMOKE unset; live vendor calls are opt-in");
    return;
  }
  if (flag === "1" || flag === "grok" || flag === "grok-build") assert.ok(process.env.XAI_API_KEY, "KNOLO_VENDOR_SMOKE requires XAI_API_KEY");
  if (flag === "1" || flag === "openclaw") assert.ok(process.env.OPENCLAW_URL, "KNOLO_VENDOR_SMOKE requires OPENCLAW_URL");
});
