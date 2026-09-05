import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import {
  Agent,
  HarnessError,
  IcpAgentRuntimeClient,
  callableAgent,
  createHarness,
  defineAgent,
  entry,
  httpAgent,
  icpAgent,
  nativeKnoloAgent,
  node,
  processAgent,
  stateSchema,
  terminal,
  toolAwareAgent,
  transition,
} from "../dist/index.js";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const srcRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../src");
const dummyTask = JSON.parse(readFileSync(resolve(root, "contracts/fixtures/harness/task-dummy-v1.json"), "utf8"));

function walk(dir) {
  const files = [];
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) files.push(...walk(path));
    else if (path.endsWith(".ts")) files.push(path);
  }
  return files;
}

function portableAgent() {
  const state = stateSchema("counter-state", { count: "Number" });
  const increment = node("increment", { writes: ["count"], run: ({ state }) => ({ outcome: { type: "continue", patch: { count: state.count + 1 } } }) });
  const done = terminal("done", { run: ({ state }) => ({ outcome: { type: "terminate", result: state.count } }) });
  return Agent.load({ definition: defineAgent({ id: "portable-counter", state, nodes: [increment, done], transitions: [transition("increment", "continue", "done")], entry: entry("increment") }), engine: "typescript" });
}

function fakeIcpActor(overrides = {}) {
  return {
    health: async () => ({ ok: true, message: "ready" }),
    inspect: async () => ({
      ok: true,
      engine: "icp",
      graph_loaded: true,
      graph_id: [],
      graph_hash: [],
      implementation_id: [],
      execution_count: 0n,
      capabilities: [],
      limitations: ["host node dispatch"],
      message: "ok",
      schema_version: 1,
      handoff_count: 0n,
    }),
    get_budget: async () => ({ ok: true, tool_calls: 0n, tool_units: 0n, llm_calls: 0n, retrieval_calls: 0n, effect_rounds: 0n, knolo_steps: 0n, knolo_tokens: 0n, knolo_cost_micros: 0n, cycles_spent_observed: 0n, last_cycles_balance: [], message: "budget" }),
    get_limits: async () => ({ ok: true, max_concurrent_executions: 1, max_events_per_execution: 1, max_execution_id_len: 1, max_state_bytes: 1, max_handoff_bytes: 1, require_controller_for_runs: false, allowed_callers: [], min_cycles_reserve: 0n, message: "ok" }),
    get_store_stats: async () => ({ ok: true, schema_version: 1, execution_count: 0n, checkpoint_count: 0n, event_entry_count: 0n, handoff_count: 0n, has_definition: false, message: "stats" }),
    list_executions: async () => ({ ok: true, execution_ids: [], message: "0" }),
    load_definition: async () => ({ ok: true, message: "loaded" }),
    clear_definition: async () => ({ ok: true, message: "cleared" }),
    set_limits: async () => ({ ok: true, max_concurrent_executions: 1, max_events_per_execution: 1, max_execution_id_len: 1, max_state_bytes: 1, max_handoff_bytes: 1, require_controller_for_runs: false, allowed_callers: [], min_cycles_reserve: 0n, message: "ok" }),
    start_execution: async (executionId, initialStateJson) => ({
      ok: true,
      execution_id: executionId,
      status: { kind: "terminated", detail: "done" },
      steps: 2n,
      tokens: 0n,
      cost_micros: 0n,
      state_json: initialStateJson,
      event_count: 1n,
      message: "ok",
    }),
    step: async () => ({ ok: true, execution_id: "x", status: { kind: "terminated", detail: "null" }, steps: 1n, tokens: 0n, cost_micros: 0n, state_json: "{}", event_count: 1n, message: "ok" }),
    resume: async executionId => ({ ok: true, execution_id: executionId, status: { kind: "terminated", detail: "resumed" }, steps: 1n, tokens: 0n, cost_micros: 0n, state_json: "{\"resumed\":true}", event_count: 1n, message: "ok" }),
    continue_effects: async () => ({ ok: true, execution_id: "x", status: { kind: "terminated", detail: "null" }, steps: 1n, tokens: 0n, cost_micros: 0n, state_json: "{}", event_count: 1n, message: "ok" }),
    accept_handoff: async () => ({ ok: true, handoff_id: "h", execution_id: "x", destination: "portable-counter", status: "accepted", message: "ok" }),
    forward_handoff: async () => ({ ok: true, handoff_id: "f", execution_id: "x", destination: "portable-counter", status: "forwarded", message: "ok" }),
    get_handoff: async () => ({ ok: false, handoff_id: "", execution_id: "", destination: "", status: "error", message: "unknown" }),
    get_events: async () => ({ ok: true, execution_id: "x", events_json: "[]", message: "0" }),
    get_checkpoint: async () => ({ ok: true, execution_id: "x", present: false, checkpoint_json: "null", message: "none" }),
    ...overrides,
  };
}

test("createHarness wraps a dummy callable agent and emits a run receipt", async () => {
  const hooks = [];
  const session = await createHarness({
    agent: callableAgent(async () => "identify suspicious transactions and cite supporting evidence; do not perform irreversible actions"),
    task: dummyTask,
    runId: "run-dummy",
    clock: () => 1,
    middleware: [{
      beforeRun: ctx => hooks.push(`beforeRun:${ctx.runId}`),
      beforeAgent: ctx => hooks.push(`beforeAgent:${ctx.envelope.dependencyRoot}`),
      afterComplete: (_ctx, extra) => hooks.push(`afterComplete:${extra.finalStatus}`),
    }],
  });
  const { result, receipt } = await session.run();
  assert.equal(result.status, "succeeded");
  assert.equal(receipt.version, 1);
  assert.equal(receipt.runId, "run-dummy");
  assert.match(receipt.harnessDependencyRoot, /^knolo\.harness\.dependencies\.v1:/);
  assert.deepEqual(receipt.evaluationReceipt.successCriteriaMatched, dummyTask.successCriteria);
  assert.deepEqual(receipt.evaluationReceipt.prohibitedViolations, []);
  assert.deepEqual(hooks[0], "beforeRun:run-dummy");
  assert.equal(hooks.at(-1), "afterComplete:succeeded");
});

test("harness fails closed on prohibited actions and unsupported tool gating", async () => {
  const session = await createHarness({
    agent: callableAgent(async () => "completed via wire_transfer"),
    task: dummyTask,
    runId: "run-denied",
  });
  const { receipt } = await session.run();
  assert.equal(receipt.finalStatus, "failed");
  assert.deepEqual(receipt.evaluationReceipt.prohibitedViolations, ["wire_transfer"]);

  await assert.rejects(
    () => createHarness({
      agent: callableAgent(async () => "ok"),
      task: { objective: "x", successCriteria: ["x"], requiredCapabilities: ["tools"] },
    }),
    HarnessError,
  );
});

test("middleware cannot mutate the frozen dependency root", async () => {
  const session = await createHarness({
    agent: callableAgent(async () => "ok"),
    task: { objective: "x", successCriteria: ["ok"] },
    runId: "run-mw",
    middleware: [{
      beforeAgent: ctx => {
        ctx.envelope = { ...ctx.envelope, dependencyRoot: "tampered" };
      },
    }],
  });
  await assert.rejects(() => session.run(), /cannot bypass compiled authority/);
});

test("callable, http, process, tool, native, and icp adapters normalize the same task", async () => {
  const task = { objective: "echo", successCriteria: ["echoed"], inputs: { count: 0 } };
  const callable = await (await createHarness({ agent: callableAgent(async () => ({ status: "succeeded", output: "echoed" })), task, runId: "a-callable" })).run();

  const http = await (await createHarness({
    agent: httpAgent({
      url: "https://example.invalid/agent",
      fetch: async () => new Response(JSON.stringify({ status: "succeeded", output: "echoed" }), { status: 200 }),
    }),
    task,
    runId: "a-http",
  })).run();

  const process = await (await createHarness({
    agent: processAgent({
      command: "/bin/agent",
      args: ["--json"],
      spawn: async request => {
        assert.equal(request.command, "/bin/agent");
        assert.deepEqual(request.args, ["--json"]);
        return { stdout: JSON.stringify({ status: "succeeded", output: "echoed" }), stderr: "", exitCode: 0 };
      },
    }),
    task,
    runId: "a-process",
  })).run();

  const tool = await (await createHarness({
    agent: toolAwareAgent({
      tools: { search_ledger: async () => ({ hits: 1 }) },
      invoke: async (_input, _ctx, tools) => {
        await tools.call("search_ledger", { q: "tx" });
        return "echoed";
      },
    }),
    task: { ...task, requiredCapabilities: ["tools"] },
    runId: "a-tool",
  })).run();

  const native = await (await createHarness({
    agent: nativeKnoloAgent(portableAgent()),
    task,
    runId: "a-native",
  })).run({ count: 0 });

  const icp = await (await createHarness({
    agent: icpAgent({ actor: fakeIcpActor() }),
    task,
    runId: "a-icp",
  })).run({ echoed: true });

  for (const run of [callable, http, process, tool]) {
    assert.equal(run.result.status, "succeeded");
    assert.equal(run.receipt.evaluationReceipt.successCriteriaMatched.includes("echoed"), true);
  }
  assert.equal(native.result.status, "succeeded");
  assert.equal(native.result.output, 1);
  assert.equal(native.receipt.agentDescriptorHash.startsWith("agent:"), true);
  assert.equal(tool.receipt.toolReceipts.includes("search_ledger"), true);
  assert.equal(icp.result.status, "succeeded");
  assert.equal(icp.receipt.runId, "a-icp");
  assert.deepEqual(icp.result.output, { echoed: true });
});

test("tool-aware adapter denies prohibited tools explicitly", async () => {
  const session = await createHarness({
    agent: toolAwareAgent({
      tools: { wire_transfer: async () => ({ sent: true }) },
      invoke: async (_input, _ctx, tools) => tools.call("wire_transfer"),
    }),
    task: dummyTask,
    runId: "run-tool-deny",
  });
  const { result } = await session.run();
  assert.equal(result.status, "failed");
  assert.match(result.error, /prohibited/);
});

test("icpAgent wraps IcpAgentRuntimeClient and resume without leaking into harness modules", async () => {
  const actor = fakeIcpActor();
  const adapter = icpAgent({ client: new IcpAgentRuntimeClient(actor), id: "canister" });
  assert.equal(adapter.descriptor().level, "platform");
  const resumed = await adapter.resume({ version: 1, runId: "exec-1", adapterId: "canister", payload: { executionId: "exec-1" } });
  assert.equal(resumed.status, "succeeded");
  assert.deepEqual(resumed.output, { resumed: true });

  const forbidden = ["harness", "middleware", "evaluation", "core-v5", "context", "skills", "capabilities", "registry", "dependencies"];
  for (const dir of forbidden) {
    for (const file of walk(join(srcRoot, dir))) {
      const text = readFileSync(file, "utf8");
      assert.equal(/from ["']\.\.\/icp/.test(text), false, file);
      assert.equal(/IcpAgentRuntimeClient/.test(text), false, file);
      assert.equal(/icpAgent/.test(text), false, file);
    }
  }
  const icpAdapter = readFileSync(join(srcRoot, "adapters/icp.ts"), "utf8");
  assert.match(icpAdapter, /from ["']\.\.\/icp\/index\.js["']/);
});

test("processAgent never enables a shell", async () => {
  let seen = null;
  await processAgent({
    command: "node",
    args: ["-e", "process.stdout.write('{\"output\":\"ok\"}')"],
    spawn: async request => {
      seen = request;
      return { stdout: JSON.stringify({ output: "ok" }), stderr: "", exitCode: 0 };
    },
  }).invoke({ n: 1 }, { runId: "p", task: dummyTask, envelope: { task: dummyTask, evidence: [], memories: [], skills: [], constraints: [], capabilities: { version: 1, level: "L0", tools: false, resume: false, observe: false, interrupt: false, limitations: [] }, budget: {}, dependencyRoot: "x", receipts: [] } });
  assert.equal(seen.command, "node");
  assert.equal(seen.args[0], "-e");
});
