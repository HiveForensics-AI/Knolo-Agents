import assert from "node:assert/strict";
import test from "node:test";
import {
  Agent,
  defineAgent,
  entry,
  IcpAgentRuntimeClient,
  node,
  portableCounterDefinition,
  portableCounterInitialState,
  stateSchema,
  terminal,
  transition,
} from "../dist/index.js";

function definition(capabilities) {
  const state = stateSchema("counter-state", { count: "Number" });
  const increment = node("increment", { writes: ["count"], capabilities, run: ({ state }) => ({ outcome: { type: "continue", patch: { count: state.count + 1 } }, tokens: 1 }) });
  const done = terminal("done", { run: ({ state }) => ({ outcome: { type: "terminate", result: state.count } }) });
  return defineAgent({ id: "portable-counter", state, nodes: [increment, done], transitions: [transition("increment", "continue", "done")], entry: entry("increment") });
}

test("portable engine produces ordered events and inferred patches", async () => {
  const agent = Agent.load({ definition: definition(), engine: "typescript" });
  const report = await agent.run({ count: 0 }, { executionId: "fixture" });
  assert.deepEqual(report.status, { type: "terminated", result: 1 });
  assert.deepEqual(report.events.map(event => event.kind.type), ["execution_started", "node_started", "state_patched", "checkpointed", "node_started", "terminated"]);
  assert.ok(report.events.every((event, index) => event.sequence === index + 1));
});

test("deterministic replay re-executes the control plane and detects divergence", async () => {
  const agent = Agent.load({ definition: definition(), engine: "typescript" });
  const first = await agent.run({ count: 0 }, { executionId: "replay-fixture" });
  const replayed = await agent.replayDeterministic({ count: 0 }, first.events);
  assert.deepEqual(replayed.status, first.status);
  await assert.rejects(() => agent.replayDeterministic({ count: 0 }, first.events.slice(0, -1)), /replay diverged/);
});

test("state snapshots make deterministic replay verify every revision", async () => {
  const agent = Agent.load({ definition: definition(), engine: "typescript" });
  const first = await agent.run({ count: 0 }, { executionId: "snapshot-fixture" });
  assert.deepEqual(first.state_snapshots?.map(snapshot => [snapshot.revision, snapshot.event_sequence, snapshot.state.value.count]), [[0, 0, 0], [1, 3, 1]]);
  const replayed = await agent.replayDeterministicWithSnapshots({ count: 0 }, { events: first.events, state_snapshots: first.state_snapshots ?? [] });
  assert.deepEqual(replayed.state, first.state);
  const mutated = structuredClone(first.state_snapshots ?? []);
  mutated[1].state.value.count = 99;
  await assert.rejects(() => agent.replayDeterministicWithSnapshots({ count: 0 }, { events: first.events, state_snapshots: mutated }), /state snapshot replay diverged at revision 1/);
});

test("pack capability grants are enforced at definition time", () => {
  const state = stateSchema("packed-state", { count: "Number" });
  const restricted = node("restricted", { capabilities: ["retrieval"], run: () => ({ outcome: { type: "continue" } }) });
  const done = terminal("done", { run: () => ({ outcome: { type: "terminate", result: null } }) });
  assert.throws(() => defineAgent({ id: "denied-pack", state, nodes: [restricted, done], transitions: [transition("restricted", "continue", "done")], entry: "restricted", pack: { version: 1, id: "minimal", capabilities: ["state"] } }), /not granted by pack/);
});

test("engine limitations and cancellation are explicit", async () => {
  assert.throws(() => Agent.load({ definition: definition(["tools"]), engine: "typescript" }), /does not support capabilities/);
  assert.throws(() => Agent.load({ definition: definition(), engine: "wasm" }), /no adapter/);
  const controller = new AbortController(); controller.abort();
  const report = await Agent.load({ definition: definition(), engine: "typescript" }).run({ count: 0 }, { signal: controller.signal });
  assert.equal(report.status.type, "cancelled");
});

test("ICP client helpers produce loadable definition JSON and wrap actors", async () => {
  const def = portableCounterDefinition();
  assert.equal(def.implementation_id, "portable-counter-v1");
  assert.equal(portableCounterInitialState(3).value.count, 3);
  let loaded = null;
  const actor = {
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
      limitations: [],
      message: "ok",
      schema_version: 1,
      handoff_count: 0n,
    }),
    get_budget: async () => ({
      ok: true,
      tool_calls: 0n,
      tool_units: 0n,
      llm_calls: 0n,
      retrieval_calls: 0n,
      effect_rounds: 0n,
      knolo_steps: 0n,
      knolo_tokens: 0n,
      knolo_cost_micros: 0n,
      cycles_spent_observed: 0n,
      last_cycles_balance: [],
      message: "budget",
    }),
    get_limits: async () => ({
      ok: true,
      max_concurrent_executions: 32,
      max_events_per_execution: 10000,
      max_execution_id_len: 128,
      max_state_bytes: 524288,
      max_handoff_bytes: 262144,
      require_controller_for_runs: false,
      allowed_callers: [],
      min_cycles_reserve: 0n,
      message: "limits",
    }),
    get_store_stats: async () => ({
      ok: true,
      schema_version: 1,
      execution_count: 0n,
      checkpoint_count: 0n,
      event_entry_count: 0n,
      handoff_count: 0n,
      has_definition: false,
      message: "stats",
    }),
    list_executions: async () => ({ ok: true, execution_ids: [], message: "0" }),
    load_definition: async (json) => {
      loaded = json;
      return { ok: true, message: "loaded" };
    },
    clear_definition: async () => ({ ok: true, message: "cleared" }),
    set_limits: async () => ({
      ok: true,
      max_concurrent_executions: 1,
      max_events_per_execution: 1,
      max_execution_id_len: 1,
      max_state_bytes: 1,
      max_handoff_bytes: 1,
      require_controller_for_runs: false,
      allowed_callers: [],
      min_cycles_reserve: 0n,
      message: "ok",
    }),
    start_execution: async () => ({
      ok: true,
      execution_id: "x",
      status: { kind: "terminated", detail: "null" },
      steps: 2n,
      tokens: 0n,
      cost_micros: 0n,
      state_json: "{}",
      event_count: 1n,
      message: "ok",
    }),
    step: async () => ({
      ok: true,
      execution_id: "x",
      status: { kind: "terminated", detail: "null" },
      steps: 1n,
      tokens: 0n,
      cost_micros: 0n,
      state_json: "{}",
      event_count: 1n,
      message: "ok",
    }),
    resume: async () => ({
      ok: true,
      execution_id: "x",
      status: { kind: "terminated", detail: "null" },
      steps: 1n,
      tokens: 0n,
      cost_micros: 0n,
      state_json: "{}",
      event_count: 1n,
      message: "ok",
    }),
    continue_effects: async () => ({
      ok: true,
      execution_id: "x",
      status: { kind: "terminated", detail: "null" },
      steps: 1n,
      tokens: 0n,
      cost_micros: 0n,
      state_json: "{}",
      event_count: 1n,
      message: "ok",
    }),
    accept_handoff: async () => ({
      ok: true,
      handoff_id: "h",
      execution_id: "x",
      destination: "portable-counter",
      status: "accepted",
      message: "ok",
    }),
    forward_handoff: async () => ({
      ok: true,
      handoff_id: "f",
      execution_id: "x",
      destination: "portable-counter",
      status: "forwarded",
      message: "ok",
    }),
    get_handoff: async () => ({
      ok: false,
      handoff_id: "",
      execution_id: "",
      destination: "",
      status: "error",
      message: "unknown",
    }),
    get_events: async () => ({ ok: true, execution_id: "x", events_json: "[]", message: "0" }),
    get_checkpoint: async () => ({
      ok: true,
      execution_id: "x",
      present: false,
      checkpoint_json: "null",
      message: "none",
    }),
  };
  const client = new IcpAgentRuntimeClient(actor);
  const health = await client.health();
  assert.equal(health.ok, true);
  await client.loadDefinition(def);
  assert.ok(typeof loaded === "string" && loaded.includes("portable-counter"));
});
