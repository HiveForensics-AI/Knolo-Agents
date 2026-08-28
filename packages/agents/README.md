# @knolo/agents

`@knolo/agents` provides typed graph builders and explicit TypeScript/WASM
execution adapters for Knolo Agents.

## Install

```bash
pnpm add @knolo/agents
```

`@knolo/core` `^5.0.0` is an optional peer integration for applications that
inject Cortex or ClaimGraph capabilities; this package does not bundle or
implement that storage layer. V4 compatibility is legacy and adapter-gated.
The V5 bridge contract is exported from `@knolo/agents` and keeps Knowledge
Image identity, evidence identity, and query receipts attached to retrieval
responses. See the deterministic fixtures under `contracts/fixtures/core/`.

## Usage

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
[`examples/icp-agent-canister/`](../../examples/icp-agent-canister/) and
[architecture documentation](../../docs/architecture/README.md).

TypeScript execution reports include versioned state snapshots for deterministic
state-level replay. Host tool integrations should preserve the shared V1 effect
receipt shape and keep raw credentials and unredacted host output outside
portable reports.

The package also includes deterministic `runLocalResearch` and `runLocalCoding`
vertical slices for acceptance testing. Both use the same graph control plane;
research injects V5 core evidence, while coding injects an explicitly approved
workspace host.

## Development

```bash
pnpm install --frozen-lockfile
pnpm --filter @knolo/agents check
pnpm --filter @knolo/agents test
```

## Status and license

This is the `0.1.3` early release of the TypeScript surface; APIs may evolve
before 1.0. The package is licensed under Apache License 2.0. See [LICENSE](LICENSE).
