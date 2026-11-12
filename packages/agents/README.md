# @knolo/agents

`@knolo/agents` issues Knolo Spawn envelopes for parent agents, and provides
typed graph builders and explicit TypeScript/WASM execution adapters. A spawn
does not call a model. The parent runs the brief and closes the receipt.

## Install

```bash
pnpm add @knolo/agents
```

`@knolo/core` `^5.5.0` is an optional peer integration for applications that
inject Cortex, ClaimGraph, or Knowledge Image capabilities; this package does
not bundle, encode VQF, or implement that storage layer.

## Spawn

```ts
import { closeSpawn, issueSpawn } from "@knolo/agents";

const issued = await issueSpawn({
  parent: { version: 1, id: "parent", level: "L1" },
  task: {
    objective: "Investigate these transactions for potential fraud.",
    successCriteria: ["identify suspicious transactions"],
    prohibitedActions: ["wire_transfer"],
    budget: { maxSteps: 4 },
  },
  authority: { capabilities: ["ledger.read"], tools: [], namespaces: [], maxSteps: 8, maxCostMicros: 1000 },
  pack: { capabilities: ["ledger.read"], tools: [], namespaces: [], maxSteps: 8, maxCostMicros: 1000 },
});

const receipt = await closeSpawn(issued.envelope, "identify suspicious transactions", { toolCalls: [] });
```

The issued authority is the intersection of `authority` and `pack`. A wider
projection throws. See [docs/spawn.md](../../docs/spawn.md).

## Usage

Graph builders remain available for a deterministic worker.

```ts
import { Agent, defineAgent, entry, node, stateSchema, terminal, transition } from "@knolo/agents";

const state = stateSchema("counter-state", { count: "Number" });
const increment = node("increment", {
  writes: ["count"],
  run: ({ state }) => ({ outcome: { type: "continue", patch: { count: state.count + 1 } } }),
});
const done = terminal("done", {
  run: ({ state }) => ({ outcome: { type: "terminate", result: state.count } }),
});

const definition = defineAgent({
  id: "counter",
  state,
  nodes: [increment, done],
  transitions: [transition("increment", "continue", "done")],
  entry: entry("increment"),
});

const report = await Agent.load({ definition, engine: "typescript" }).run({ count: 0 });
console.log(report.status); // { type: "terminated", result: 1 }
```

Select `engine: "typescript"` for the portable deterministic subset. Select
`engine: "wasm"` only when supplying an explicit `WasmProtocolAdapter`; the
package never silently falls back to another engine. Tool calls, retrieval, and
durable effects remain host-bound or Rust/WASM integrations.

The package also exports pack references, replay validation, checkpoint/HITL
contracts, Cortex and ClaimGraph injection interfaces, multi-agent authority
helpers, and an **ICP canister client** (`IcpAgentRuntimeClient` + candid-aligned
DTOs). The ICP client does not hard-depend on `@dfinity/agent`; pass an actor
built from your dfx declarations for live calls. See
[`examples/icp-agent-canister/`](https://github.com/HiveForensics-AI/Knolo-Agents/tree/main/examples/icp-agent-canister)
and
[architecture documentation](https://github.com/HiveForensics-AI/Knolo-Agents/blob/main/docs/architecture/README.md).

## Development

```bash
pnpm install --frozen-lockfile
pnpm --filter @knolo/agents check
pnpm --filter @knolo/agents test
```

## Status and license

This is the `0.3.0` release of the TypeScript surface; APIs may evolve before
1.0. The optional `@knolo/core` peer is `^5.5.0`. The package is licensed under
Apache License 2.0. See [LICENSE](LICENSE).
