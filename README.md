# Knolo Agents

Knolo Agents is an independent toolkit for reliable, inspectable AI agents. Its
rule is **Explicit > Magic**: typed graphs, authority, effects, state changes, and
replay inputs remain reviewable.

## Start here

- Rust runtime: `crates/knolo-agent`; portable contracts: `crates/knolo-agent-core`.
- TypeScript SDK: `packages/agents` (`@knolo/agents`).
- Cross-runtime schemas and fixtures: `contracts`.
- Runnable and copyable scenarios with least-authority packs: `examples`.
- Design and operating documentation: `docs`.

Run `cargo test --workspace` and `pnpm --filter @knolo/agents test` after installing
with the locked pnpm version. See `CONTRIBUTING.md` for the complete checks.

## Dependency boundary

Knolo Agents depends on, but is separate from, `@knolo/core`. Core is a peer
installed by consumers and may inject Cortex and ClaimGraph capabilities. Its
implementation, data, credentials, and releases are not included here. See
`docs/core-boundary.md`.

## Safety and durability

Packs grant capabilities and budgets explicitly. Policy checks every effect;
validated state transactions emit ordered events. Checkpoints bind graph, pack,
policy, node, and contract hashes. Handoffs narrow authority, human resumes expire,
and live-effect replay requires explicit authorization.

Rust crates and `@knolo/agents` use independent semantic versions. Compatibility
and release rules are documented in `docs/compatibility.md` and
`docs/releasing.md`. Security reports follow `SECURITY.md`.
