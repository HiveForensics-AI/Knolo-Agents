# Architecture

Knolo Agents is an independent Rust runtime and TypeScript SDK. Definitions are
compiled into deterministic graphs; a scheduler applies validated state patches,
emits ordered events, and checkpoints before an external suspension. Hosts inject
tools, storage, clocks, and capabilities. No provider is discovered implicitly.

`knolo-agent-core` owns portable contracts, `knolo-agent` owns native execution,
`knolo-agent-wasm` exposes the JSON protocol, `knolo-agent-icp` hosts the control
plane inside an ICP canister (Phase 1 PoC), and `@knolo/agents` owns ergonomic
TypeScript builders. `@knolo/core` is a separately published peer dependency. It
owns Cortex and ClaimGraph data and implementations; this repository contains
only typed injection interfaces and never vendors, re-exports, or publishes core.

ICP architecture decisions and constraints:

- [ADR-001: ICP agent runtime](adr-001-icp-agent-runtime.md)
- [ICP constraints matrix](icp-constraints-matrix.md)
