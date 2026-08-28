# Architecture

Knolo Agents is an independent Rust runtime and TypeScript SDK. Definitions are
compiled into deterministic graphs; a scheduler applies validated state patches,
emits ordered events, and checkpoints before an external suspension. Hosts inject
tools, storage, clocks, and capabilities. No provider is discovered implicitly.

`knolo-agent-core` owns portable contracts, `knolo-agent` owns native execution,
`knolo-agent-system` is the full product composition workspace, and
`@knolo/agents` owns ergonomic TypeScript builders and host clients.
`knolo-agent-wasm` and `knolo-agent-icp` are optional deployment adapters;
neither defines the product architecture. `@knolo/core` is a separately
published peer dependency and the canonical knowledge/evidence substrate. This
repository contains only typed integration interfaces and never vendors,
re-exports, or publishes core.

The system boundary is documented in [the agent-system architecture](agent-system.md).

ICP architecture decisions and constraints:

- [ADR-001: ICP deployment adapter](adr-001-icp-deployment-adapter.md)
- [ICP constraints matrix](icp-constraints-matrix.md)
- [ICP cost guide](icp-cost-guide.md)
- [ICP security checklist](icp-security-checklist.md)
