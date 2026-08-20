# Knolo Product Runtime

This directory contains the Rust harness source being adapted into the Knolo
product. Knolo is the product name; the historical upstream crate identifiers
inside this source tree are implementation provenance and are not public
product names.

The supported user entry point is the Knolo CLI in the parent workspace:

```bash
cargo install --path ../crates/knolo-agent --bin knolo
knolo init
knolo agent list
knolo run --agent coding "list files"
```

From the parent repository, see:

- [`README.md`](../README.md) — product overview and workspace quickstart;
- [`docs/cli.md`](../docs/cli.md) — installation, profiles, tasks, approvals,
  sessions, and model planner adapters;
- [`docs/migration/README.md`](../docs/migration/README.md) — the eight-phase
  harness migration and productization plan.

## What this runtime contributes

The harness source provides the implementation material for the Knolo product
surfaces planned in the migration:

- interactive terminal rendering and session UI;
- agent lifecycle, conversation state, compaction, and model turns;
- workspace discovery, file operations, VCS/worktrees, search, and PTY control;
- tools, MCP/ACP adapters, hooks, plugins, sandboxing, and session persistence;
- headless operation, diagnostics, crash handling, and test support.

These capabilities must be connected through Knolo’s existing contracts and
policy boundaries before they are exposed as product defaults. Profiles
describe mission and role, while packs and host policy grant tools, workspaces,
credentials, memory, and process authority.

## Building the harness source

The source tree has its own large Cargo closure. Use the pinned toolchain and
package-specific commands below when working on an extracted component:

```bash
cargo check -p xai-grok-pager-bin
cargo test -p xai-grok-config
```

The parent workspace’s supported product checks remain:

```bash
cargo fmt --all --check
cargo test --workspace
pnpm --filter @knolo/agents check
```

The harness workspace is not silently merged into the parent Cargo workspace.
The parent Knolo runtime remains authoritative for portable contracts, policy,
packs, events, checkpoints, replay, and host effect authorization.

## Documentation and naming

New user-facing instructions belong in the parent Knolo README and `docs/`.
Component READMEs in this directory describe implementation details only. They
must not advertise an upstream product, upstream installer, upstream login, or
upstream telemetry as the Knolo product experience.

The public executable is `knolo`. Historical internal names may remain in Rust
module paths while extraction is staged; any such name must be hidden behind a
Knolo adapter before publication.

## Legal and provenance

This source includes adapted and third-party material. The Apache-2.0 license,
copyright statements, `THIRD-PARTY-NOTICES`, vendored licenses, and source
revision record are retained as required legal and provenance artifacts. They
are not product branding and must not be deleted from a distributed build.
See [`PROVENANCE.md`](PROVENANCE.md) and [`LEGAL/README.md`](LEGAL/README.md).
