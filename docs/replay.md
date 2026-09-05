# Replay

Replay verifies contiguous ordered events and all artifact hashes. `verify_only`
checks history, `mocked_effects` substitutes recorded tool/retrieval results, and
`live_effects` repeats effects only with a separate authorization. Replay never
silently upgrades contracts or bypasses current policy.

## TypeScript portable replay

`Agent.replay` validates that events are version 1, contiguous, and belong to
one execution.

`Agent.replayDeterministic` re-executes the portable graph with the recorded
`execution_id` and compares the control-plane trace **excluding wall-clock
timestamps**. Pass either the recorded events or a `ReplayTraceV1`:

```ts
const first = await agent.run({ count: 0 }, { executionId: "replay-fixture" });
await agent.replayDeterministic({ count: 0 }, first.events);
await agent.replayDeterministic({ count: 0 }, recordReplayTrace(first));
```

A `ReplayTraceV1` records ordered events **and** per-revision `StateSnapshot`
values (`schema_id`, `revision`, `value`, `provenance`). When snapshots are
present, replay fails closed if state diverges even when event kinds still
match. Truncated history, mutated snapshot values, and mismatched revisions
are rejected. Timestamp-only differences are ignored.

The TypeScript engine records snapshots on `ExecutionReport.snapshots`: the
initial revision and every applied patch. Scope is the portable capability set
(state, routing, suspension). Tool and network effects stay host-bound and are
not invented inside TypeScript-only replay.

Fixture: `contracts/fixtures/replay/portable-counter-trace-v1.json`.
