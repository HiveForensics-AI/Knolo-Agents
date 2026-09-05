# Migration guide (universal harness)

Existing Knolo-native graph applications do not have to be rewritten. The
universal harness is additive: wrap an agent, or keep calling `Agent.load`.

This page is the 1.0 freeze companion to
[compatibility](compatibility.md) and the
[universal harness contract](universal-harness-contract.md).

## No mandatory rewrite

`Agent.load({ engine: "typescript" | "wasm" })`, `run`, `stream`, `resume`,
`replay`, `replayDeterministic`, and `inspect` stay. Graph builders
(`defineAgent`, `stateSchema`, `node`, `terminal`, `transition`, `entry`,
`compile`, `fromPack`) stay. Pack deny-by-default, HITL resume, replay
validation, and authority-narrowing handoffs stay.

To put a native graph behind the harness without changing the graph:

```ts
import { Agent, createHarness, nativeKnoloAgent } from "@knolo/agents";

const agent = Agent.load({ definition, engine: "typescript" });
const harness = await createHarness({
  agent: nativeKnoloAgent(agent),
  task: {
    objective: "Investigate these transactions for potential fraud.",
    successCriteria: ["identify suspicious transactions", "cite supporting evidence"],
  },
});
await harness.run();
```

## Wrap a non-Knolo agent

```ts
import { callableAgent, createHarness } from "@knolo/agents";

const harness = await createHarness({
  agent: callableAgent(existingAgent),
  knowledge: ["./company.knolo"],
  skills: { resolution: "local" },
  memory: true,
  evaluation: true,
});
```

| You have | Adapter | Level |
| --- | --- | --- |
| Async function | `callableAgent()` | L0 |
| HTTP endpoint | `httpAgent({ fetch })` | L0 / L1 |
| Explicit argv process | `processAgent()` | L0 |
| Tool / function bridge | `toolAwareAgent()` | L1 |
| In-process `Agent` | `nativeKnoloAgent()` | L3 |
| ICP canister actor | `icpAgent({ actor })` | platform |

Do **not** add `engine: "icp"` to `Agent.load`. ICP is a platform adapter.

## Core peer

| Agents line | `@knolo/core` |
| --- | --- |
| 0.1.3 and earlier | `^3.5.0` (do not use for new harness code) |
| 0.2+ conversion | `^5.1.0`, optional |

Missing Core fails closed at the V5 adapter boundary. Legacy
`CortexCapability` / `ClaimGraphCapability` remain.

## Skills, Hub, and publish defaults

- Trust defaults to `registry: disabled`. Nothing is downloaded.
- `acquire-approved` / `acquire-any-verified` are opt-in and **stage for the
  next run**. The active dependency set cannot change mid-run.
- A downloaded skill can request a capability; it cannot grant one.
- Local experience promotion does not publish to Hub.
- `publishLearnedSkill` requires usefulness, evaluation, provenance, and
  explicit approval. `propose-only` does not call Hub.

Read existing `knolo.lock.json`. Do not invent a second lockfile.

## Vendor examples

Grok Build, Grok, and OpenClaw wrappers live under `examples/adapters/`. They
are not published package names. The Claude example was replaced by the Grok
Build session adapter. Live vendor smoke is `KNOLO_VENDOR_SMOKE` and is never
required for the default unit suite.

## Receipts

Harness receipts (`HarnessRunReceiptV1`) are a new versioned family. They do
not reinterpret `ExecutionEventV1` or `CheckpointV1`. Rust
`knolo-agent-core` parses the same Task / dependency-root / run-receipt
JSON as TypeScript.

## Still not freeze-complete

A 1.0 **version bump** still waits on the remaining P0 item in
[FUTURE.md](../FUTURE.md): pack-owned run budgets. TypeScript state-snapshot
replay and portable WASM execute/resume are in-tree. The surfaces listed in
[compatibility](compatibility.md) must not be removed in the meantime.
