# @knolo/agents

`@knolo/agents` provides typed graph builders, explicit TypeScript/WASM
execution adapters, and the **additive universal harness** for Knolo Agents.
Existing `Agent.load` APIs stay. ICP is a platform adapter (`IcpAgentRuntimeClient`
/ `icpAgent()`), not harness core.

## Install

```bash
pnpm add @knolo/agents
```

`@knolo/core` `^5.1.0` is an optional peer for Knowledge Images, Cortex,
ClaimGraph, authority, and durable runs. This package does not bundle or
implement that storage layer. Missing Core fails closed at the V5 adapter
boundary.

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
package never silently falls back to another engine. The WASM adapter runs
state, routing, and suspension, then `dispatch`es each node so host handlers
answer with `continue`. Tool calls, retrieval, and durable effects remain
host-bound.

```ts
import { Agent } from "@knolo/agents";

const agent = Agent.load({
  definition,
  engine: "wasm",
  wasm: { command: (request) => wasmModule.command(request) },
});
await agent.run({ count: 0 });
```

Wrap a callable agent with the harness:

```ts
import { callableAgent, createHarness } from "@knolo/agents";

const harness = await createHarness({
  agent: callableAgent(async () => "identify suspicious transactions and cite supporting evidence"),
  task: {
    objective: "Investigate these transactions for potential fraud.",
    successCriteria: ["identify suspicious transactions", "cite supporting evidence"],
  },
});
const { receipt } = await harness.run();
```

Local skills resolve from existing `.knolo` JSON metadata (no Hub):

```ts
const { envelope, skills } = await (await createHarness({
  agent: callableAgent(async () => "identify suspicious transactions"),
  task: {
    objective: "Investigate these transactions for potential fraud.",
    successCriteria: ["identify suspicious transactions"],
    preferredSkills: ["ledger-review"],
  },
  authority: { capabilities: ["ledger.read"] },
  skills: { resolution: "local", packs: [ledgerReviewPack] },
})).run();
```

Unauthorized skills are omitted from the envelope and recorded on
`SkillSelectionReceiptV1`. Automatic Hub acquisition is opt-in and
**next-run only**. `skills.registry: "disabled"` never downloads.
`acquire-approved` requires an allowlist. A downloaded skill can request a
capability; it cannot grant one. Publish stays `propose-only`.

```ts
const { acquisition, staged } = await (await createHarness({
  agent: callableAgent(async () => "ok"),
  task: { objective: "Complete a kyc.read identity review.", successCriteria: ["cite supporting evidence"], requiredCapabilities: ["kyc.read"] },
  authority: { capabilities: ["kyc.read"] },
  registry,
  skills: { resolution: "auto", registry: "acquire-approved", allowlist: ["acme/kyc-review"] },
})).run();
// acquisition.staged is used on the subsequent run; this run's dependency root is unchanged
```

Search/pull is also available directly via `memoryPackRegistry` or
`httpPackRegistry` (host `fetch`, existing `knolo.lock.json`):

```ts
import { httpPackRegistry, parseLockfile } from "@knolo/agents";

const registry = httpPackRegistry({
  baseUrl: "https://hub.knolo.dev",
  fetch,
  lockfile: parseLockfile(lockfileJson),
});
const { bytes, manifest } = await registry.pull("acme/refund-policy@1.2.0");
```

Each run freezes `HarnessDependencyRootV1` before the adapter runs. Packs pulled
after that freeze are staged for the next run only.

`memory: true` records local experience. Repeated successful runs can be
promoted to a local skill after the usefulness / evaluation / provenance /
approval gates. Hub publish stays off:

```ts
const session = await createHarness({
  agent: callableAgent(async () => "identify suspicious transactions and cite supporting evidence"),
  task: {
    objective: "Investigate these transactions for potential fraud.",
    successCriteria: ["identify suspicious transactions", "cite supporting evidence"],
  },
  memory: true,
  experience: { promote: "auto-approved", minUsefulness: 2 },
});
await session.run();
await session.run();
const { envelope } = await session.run(); // learned skill is available
```

Pass an `AcsSuiteV1` as `evaluators` to score the run. Recovery is on by
default (`maxRetries: 1`); policy denials are not retried.

```ts
const { acs, receipt } = await (await createHarness({
  agent: callableAgent(async () => "identify suspicious transactions and cite supporting evidence from ledger-pack"),
  task: { objective: suite.task.objective, successCriteria: suite.task.successCriteria },
  evaluators: suite,
  recovery: { maxRetries: 1 },
})).run();
```

ICP stays out of `createHarness` options. Pass `icpAgent({ actor })` as `agent`.
Vendor Grok Build / Grok / OpenClaw wrappers live under
[`examples/adapters/`](../../examples/adapters/) and call `knoloMcpBridge()`
for retrieval, skills, and evaluation tools. They are not published package
names and do not add vendor SDKs here. A promoted local skill can become an
immutable pack through `publishLearnedSkill` (explicit approval; secrets fail
closed; Hub publish is never automatic).

The package also exports pack references, replay validation, checkpoint/HITL
contracts, Cortex and ClaimGraph injection interfaces, Core V5 adapters,
multi-agent authority helpers, ACS baseline scoring, and an **ICP canister
client** (`IcpAgentRuntimeClient` + candid-aligned DTOs). The ICP client is
**not** part of the harness core: wrap it with `icpAgent()` when using
`createHarness`. It does not hard-depend on `@dfinity/agent`; pass an actor
built from your dfx declarations for live calls. See
[`examples/icp-agent-canister/`](../../examples/icp-agent-canister/),
[the universal harness contract](../../docs/universal-harness-contract.md),
and [architecture documentation](../../docs/architecture/README.md).

## Development

```bash
pnpm install --frozen-lockfile
pnpm --filter @knolo/agents check
pnpm --filter @knolo/agents test
```

## Status and license

In-tree npm version is **0.1.3**. The additive harness is intended as **0.2.0**
on the next publish after this conversion merges (see
[`docs/releasing.md`](../../docs/releasing.md)). Freeze classes (frozen L3 APIs
vs stable-on-path-to-1.0 harness vs experimental examples) are in
[`docs/compatibility.md`](../../docs/compatibility.md). A 1.0 version bump still
waits on remaining P0 items in [`FUTURE.md`](../../FUTURE.md) (pack-owned run
budgets). TypeScript state-snapshot replay and portable WASM execute/resume are
in-tree.

The package is licensed under Apache License 2.0. See [LICENSE](LICENSE).
