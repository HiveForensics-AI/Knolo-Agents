# Knolo Agent System boundary

Knolo is assembled from one product system and several explicit runtimes and
adapters. The full product is not the ICP canister and it is not the portable
contract crate alone.

```text
┌──────────────────────────────────────────────────────────────┐
│ knolo-agent-system                                           │
│ Full product: shell/TUI, sessions, workspace, models,        │
│ sandbox, MCP/ACP, plugins, diagnostics, and user workflows   │
└───────────────────────────┬──────────────────────────────────┘
                            │ consumes
┌───────────────────────────▼──────────────────────────────────┐
│ knolo-agent / @knolo/agents                                  │
│ Native scheduler, policy, approvals, host effects, SDK,      │
│ graph execution, checkpoints, replay, and product clients    │
└───────────────────────────┬──────────────────────────────────┘
                            │ shared contracts
┌───────────────────────────▼──────────────────────────────────┐
│ knolo-agent-core                                             │
│ Versioned graphs, state, events, packs, policy, HITL,        │
│ handoffs, memory references, retrieval/effect DTOs            │
└───────────────┬───────────────────────┬──────────────────────┘
                │                       │
                ▼                       ▼
       @knolo/core adapter       Optional host adapters
       V5 Knowledge Images,     local/server · WASM · ICP
       V4 migration path        · browser · MCP/ACP
       evidence, receipts,
       Cortex, ClaimGraph
```

## Ownership

`@knolo/core` owns knowledge artifacts, source/evidence identity, deterministic
retrieval, verification, query plans/receipts, Cortex, ClaimGraph, and its
published V5 runtime primitives. Knolo Agents must consume those through narrow
adapters and must not create a competing `.knolo`/Knowledge Image store. V4 is
supported only where a legacy migration or compatibility adapter is explicit.

`knolo-agent-core` owns the portable agent contract vocabulary and validation.
`knolo-agent` owns the authoritative native execution and policy path.
`knolo-agent-system` owns the complete user-facing product composition and the
Grok-derived capabilities being adapted into that path. Its independent Cargo
workspace is intentional: it is a product dependency boundary and provenance
area, not a root-workspace crate.

`knolo-agent-icp` is an optional deployment adapter. It maps the same scheduler
and contracts onto Candid, stable memory, timers, inter-canister calls, and ICP
cycles. ICP-specific persistence or effects must not leak into the product
contracts or become required for local/server operation.

## Integration rule

The first publishable system path is local/server product execution backed by
the native agent runtime and a V5 `@knolo/core` adapter. V4 compatibility is a
legacy path and must be explicitly selected. Product actions, regardless of origin, must
become validated tool calls or route decisions before host execution. Core
artifact and evidence fingerprints are recorded in agent events/checkpoints;
agent code does not reimplement core verification.

The product workspace carries this boundary in
`knolo-agent-system/crates/integration/knolo-governed-adapter`. It normalizes
product requests into `ToolCallV1` and validates their shape, while leaving
pack policy, approvals, registered implementations, and effect receipts to
the native host runtime.

The completion order is therefore:

1. core compatibility adapter and conformance fixtures;
2. shared native policy/event/checkpoint/replay path;
3. one coding and one research product workflow;
4. additional product surfaces and deployment adapters, including ICP.

See [the migration plan](../migration/knolo-agent-integration-plan.md) for
the release gates.
