# Architecture

Knolo Spawn is the front door. A parent agent calls `issueSpawn` and receives an
inert envelope. The parent, or a worker it chooses, runs the brief. `closeSpawn`
binds the output to a receipt. Definitions can still be compiled into
deterministic graphs; a scheduler applies validated state patches, emits ordered
events, and checkpoints before an external suspension. Those graphs are optional
workers. Hosts inject tools, storage, clocks, and capabilities. No provider is
discovered implicitly. A spawn does not call a model.

`knolo-agent-core` owns portable contracts, including spawn validation.
`knolo-agent` owns native execution for callers that want a deterministic worker.
`knolo-agent-wasm` exposes the JSON protocol, `knolo-agent-icp` hosts that worker
inside an ICP canister (Phases 0–4: deterministic runtime, host effects, stable
structures, DX), and `@knolo/agents` owns `issueSpawn`, `closeSpawn`, and the
ergonomic TypeScript builders plus an optional ICP client. `@knolo/core` is a
separately published peer dependency. It owns Cortex and ClaimGraph data and
implementations; this repository contains only typed injection interfaces and
never vendors, re-exports, or publishes core.

ICP architecture decisions and constraints:

- [ADR-001: ICP agent runtime](adr-001-icp-agent-runtime.md)
- [ICP constraints matrix](icp-constraints-matrix.md)
- [ICP cost guide](icp-cost-guide.md)
- [ICP security checklist](icp-security-checklist.md)
