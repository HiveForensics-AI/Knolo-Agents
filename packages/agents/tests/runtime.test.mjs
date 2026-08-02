import assert from "node:assert/strict";
import test from "node:test";
import { Agent, defineAgent, entry, node, stateSchema, terminal, transition } from "../dist/index.js";

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

test("engine limitations and cancellation are explicit", async () => {
  assert.throws(() => Agent.load({ definition: definition(["tools"]), engine: "typescript" }), /does not support capabilities/);
  assert.throws(() => Agent.load({ definition: definition(), engine: "wasm" }), /no adapter/);
  const controller = new AbortController(); controller.abort();
  const report = await Agent.load({ definition: definition(), engine: "typescript" }).run({ count: 0 }, { signal: controller.signal });
  assert.equal(report.status.type, "cancelled");
});
