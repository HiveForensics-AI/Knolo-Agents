import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import {
  Agent,
  defineAgent,
  entry,
  node,
  recordReplayTrace,
  stateSchema,
  terminal,
  transition,
} from "../dist/index.js";

const fixture = JSON.parse(
  readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), "../../../contracts/fixtures/replay/portable-counter-trace-v1.json"), "utf8"),
);

function portable() {
  const state = stateSchema("counter-state", { count: "Number" });
  const increment = node("increment", { writes: ["count"], run: ({ state }) => ({ outcome: { type: "continue", patch: { count: state.count + 1 } } }) });
  const done = terminal("done", { run: ({ state }) => ({ outcome: { type: "terminate", result: state.count } }) });
  return Agent.load({ definition: defineAgent({ id: "portable-counter", state, nodes: [increment, done], transitions: [transition("increment", "continue", "done")], entry: entry("increment") }), engine: "typescript" });
}

test("portable engine records per-revision snapshots", async () => {
  const report = await portable().run({ count: 0 }, { executionId: "replay-fixture" });
  assert.equal(report.snapshots.length, 2);
  assert.deepEqual(report.snapshots[0], { schema_id: "counter-state", revision: 0, value: { count: 0 }, provenance: null });
  assert.equal(report.snapshots[1].revision, 1);
  assert.deepEqual(report.snapshots[1].value, { count: 1 });
  assert.equal(report.snapshots[1].provenance.event_sequence, 3);
});

test("replayDeterministic accepts a recorded trace including snapshots", async () => {
  const agent = portable();
  const first = await agent.run({ count: 0 }, { executionId: "replay-fixture" });
  const replayed = await agent.replayDeterministic({ count: 0 }, recordReplayTrace(first));
  assert.deepEqual(replayed.status, first.status);
  assert.deepEqual(replayed.snapshots.map(item => item.value), first.snapshots.map(item => item.value));
});

test("golden portable-counter replay fixture matches a live run", async () => {
  const replayed = await portable().replayDeterministic({ count: 0 }, fixture);
  assert.equal(replayed.status.type, "terminated");
  assert.deepEqual(replayed.snapshots[1].value, { count: 1 });
});

test("truncated event history fails closed", async () => {
  const agent = portable();
  const first = await agent.run({ count: 0 }, { executionId: "trunc-events" });
  await assert.rejects(() => agent.replayDeterministic({ count: 0 }, first.events.slice(0, -1)), /replay diverged|contiguous/);
});

test("truncated snapshot history fails closed even when events match", async () => {
  const agent = portable();
  const first = await agent.run({ count: 0 }, { executionId: "trunc-snapshots" });
  const trace = recordReplayTrace(first);
  await assert.rejects(
    () => agent.replayDeterministic({ count: 0 }, { ...trace, snapshots: trace.snapshots.slice(0, 1) }),
    /state snapshots/,
  );
});

test("mutated snapshot value fails closed even when event kinds match", async () => {
  const agent = portable();
  const first = await agent.run({ count: 0 }, { executionId: "mutated-state" });
  const trace = recordReplayTrace(first);
  const mutated = {
    ...trace,
    snapshots: trace.snapshots.map((snapshot, index) => index === 1 ? { ...snapshot, value: { count: 99 } } : snapshot),
  };
  await assert.rejects(() => agent.replayDeterministic({ count: 0 }, mutated), /state snapshots/);
});

test("timestamp differences do not fail replay", async () => {
  const agent = portable();
  const first = await agent.run({ count: 0 }, { executionId: "ts-insensitive" });
  const shifted = {
    version: 1,
    events: first.events.map(event => ({ ...event, timestamp_ms: event.timestamp_ms + 10_000 })),
    snapshots: first.snapshots,
  };
  const replayed = await agent.replayDeterministic({ count: 0 }, shifted);
  assert.deepEqual(replayed.status, first.status);
});
