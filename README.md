# Knolo Agents

Knolo Agents is an independent toolkit for building reliable, inspectable AI
agents around reusable packs. Its guiding philosophy is **Explicit > Magic**:
configuration, capabilities, permissions, and execution should be visible,
reviewable, and testable.

## Pack-centric design

A pack is the unit of agent capability. It describes what an agent can do,
which contracts it follows, and how it can be composed with other packs. Packs
make behavior portable without hiding important runtime decisions behind
implicit discovery.

## Architecture

- `crates/knolo-agent-core` contains provider-neutral contracts and primitives.
- `crates/knolo-agent` contains the Rust agent runtime surface.
- `packages/agents` publishes the TypeScript package `@knolo/agents`.
- `contracts/` holds schemas and deterministic fixtures.
- `examples/` contains small, runnable usage patterns.
- `docs/architecture/` records Knolo-owned design decisions.

`@knolo/core` is a dependency boundary consumed by the TypeScript package; its
implementation is not bundled or duplicated here.

## Workspace

Rust uses Cargo. TypeScript uses pnpm, selected as the single Node package
manager for this repository; `pnpm-lock.yaml` is the only Node lockfile.

## Roadmap

1. Stabilize core pack and agent contracts.
2. Add explicit pack validation and capability policies.
3. Connect the Rust runtime to the TypeScript APIs and schema fixtures.
4. Add documented persistence, observability, and deployment adapters.

This repository is at the foundation phase; APIs may evolve as the contracts
are exercised by real packs.
