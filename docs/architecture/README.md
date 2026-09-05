# Architecture

Knolo Agents is an independent Rust runtime, TypeScript SDK, and **additive
universal harness**. The in-process graph runtime remains the highest-assurance
(L3) execution mode. The harness wraps arbitrary agents behind `AgentAdapter`
so they can receive Knolo knowledge, skills, memory, policy, recovery, and
evaluation without a rewrite. See
[the universal harness contract](../universal-harness-contract.md).

Definitions are compiled into deterministic graphs; a scheduler applies
validated state patches, emits ordered events, and checkpoints before an
external suspension. Hosts inject tools, storage, clocks, and capabilities. No
provider is discovered implicitly.

`knolo-agent-core` owns portable contracts (including harness Task,
dependency-root, and run-receipt JSON). `knolo-agent` owns native in-process
execution, `knolo-agent-wasm` exposes the JSON protocol (inspect, portable
run/resume, host `continue`) for the in-process WASM engine, and
`@knolo/agents` owns ergonomic TypeScript builders
**plus** the harness shell. `knolo-agent-icp` hosts the control plane inside an
ICP canister; it is a **platform adapter / host**, not a harness subsystem.
TypeScript reaches it through `icpAgent()` over `IcpAgentRuntimeClient`.
`@knolo/core` is a separately published optional peer (`^5.1.0`). It owns
Knowledge Images, Cortex, ClaimGraph, authority, and durable run identity;
this repository contains only typed adapters and never vendors, re-exports, or
publishes core.

ICP architecture decisions and constraints (host crate, not harness core):

- [ADR-001: ICP agent runtime](adr-001-icp-agent-runtime.md)
- [ICP constraints matrix](icp-constraints-matrix.md)
- [ICP cost guide](icp-cost-guide.md)
- [ICP security checklist](icp-security-checklist.md)
