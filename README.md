# Knolo Agents

Knolo Agents is an independent toolkit for reliable, inspectable AI agents. Its
rule is **Explicit > Magic**: typed graphs, authority, effects, state changes, and
replay inputs remain reviewable.

The Rust scheduler is the authoritative execution runtime. The TypeScript package
is an ergonomic graph builder and portable in-memory engine for the `state`,
`routing`, and `suspension` subset; tool, retrieval, and durable-checkpoint effects
remain host-bound or Rust/WASM integrations. This boundary is intentional, not a
silent fallback.

## Start here

- Rust runtime: `crates/knolo-agent`; portable contracts: `crates/knolo-agent-core`.
- TypeScript SDK: `packages/agents` (`@knolo/agents`).
- Cross-runtime schemas and fixtures: `contracts`.
- Runnable and copyable scenarios with least-authority `.knolo` pack declarations: `examples`.
- Design and operating documentation: `docs`.

Run `cargo test --workspace` and `pnpm --filter @knolo/agents test` after installing
with the locked pnpm version. See `CONTRIBUTING.md` for the complete checks.

## Dependency boundary

Knolo Agents depends on, but is separate from, `@knolo/core`. Core is a peer
installed by consumers and may inject Cortex and ClaimGraph capabilities. Its
implementation, data, credentials, and releases are not included here. See
`docs/core-boundary.md`.

## Safety and durability

Packs are the authority source: they grant capabilities, namespaces, tools,
argument constraints, and budgets explicitly. Rust compiles a pack into immutable
policy and checks every effect; the TypeScript builder also rejects graph
capabilities absent from a referenced pack.

Real agent constraints can be loaded from a JSON companion manifest (`.knolo.json`)
with `knolo_agent::pack::load_agent` or `load_agent_file`. See
`cargo run -p knolo-agent --example pack_e2e` for pack loading, an allowed and
denied tool call, and deterministic replay of the control plane. The current
loader consumes references and authority; resolving native `.knolo` binary
storage remains a future `@knolo/core` integration.

Policy checks every effect;
validated state transactions emit ordered events. Checkpoints bind graph, pack,
policy, node, and contract hashes. Handoffs narrow authority, human resumes expire,
and live-effect replay requires explicit authorization.

Rust crates and `@knolo/agents` use independent semantic versions. Compatibility
and release rules are documented in `docs/compatibility.md` and
`docs/releasing.md`. Security reports follow `SECURITY.md`.
