# Knolo Agent

Knolo Agent is a governed, inspectable agent runtime for bounded work on a
local workspace or an integrated host. It turns a user request into a
controlled sequence of planning, authorization, action, observation, and
verification. Every run is constrained by the agent profile, granted
capabilities, workspace scope, budgets, and approval requirements.

The public entry point is the `knolo` CLI:

```bash
# Run from the repository root.
cargo install --path crates/knolo-agent --bin knolo
knolo init
knolo agent list
knolo run --agent coding "list files"
```

From the parent repository, see:

- [`README.md`](../README.md) — Knolo Agents architecture and workspace
  quickstart;
- [`docs/cli.md`](../docs/cli.md) — CLI commands, profiles, approvals,
  sessions, and model adapters;
- [`docs/install.md`](../docs/install.md) — installation and model setup;
- [`examples/README.md`](../examples/README.md) — release examples for
  standalone and integrated use.

## Build this workspace

This directory is source-distributed as part of the Knolo Agents repository; it
is not a separately published Rust workspace. Build the adapted interactive
product from the repository root with:

```bash
cargo build --manifest-path knolo-agent-system/Cargo.toml \
  -p xai-grok-pager-bin --release
```

The resulting development binary is `xai-grok-pager`. End users should install
the supported `knolo` CLI from the parent workspace using
[`install.sh`](../install.sh). The historical `xai-*` names remain in this
workspace for provenance and dependency compatibility.

## Examples

Knolo Agent can run as a standalone CLI or as part of the wider Knolo Agents
platform. The product name is **Knolo Agent** and this directory is the full
`knolo-agent-system/` product workspace. It contains the interactive product
system adapted from Grok and integrated toward the governed Knolo runtime; it
is not the portable contract crate and it is not an ICP-only product.

### Standalone CLI

Install the `knolo` executable from the repository root and initialize a local
profile store:

```bash
sh install.sh
knolo init
knolo agent list
knolo agent create --template coding coding-agent
knolo agent inspect coding-agent
knolo run --agent coding-agent "inspect the workspace and report what needs attention"
```

Read-only tasks can run without write approval. A write task requires explicit
approval:

```bash
knolo run --agent coding-agent --yes "create a short TODO.md for this project"
knolo session replay <run-id>
knolo session export <run-id>
```

This standalone mode uses the native Knolo runtime and local workspace host. It
does not require a separate `@knolo/core` installation or a remote service.

### Knolo Agent with the Knolo Agents platform

Knolo Agent is part of the Knolo Agents platform boundary. The native runtime
owns execution, policy, packs, events, checkpoints, replay, and host effect
authorization. The TypeScript package exposes typed builders and client
interfaces, while `@knolo/core` can provide Cortex and ClaimGraph capabilities
as an optional peer dependency.

```text
agent definition → profile and pack → Knolo Agent runtime → host effects
                                      ↓
                         events, checkpoints, replay, report
```

The workspace integration is available from the parent repository through the
Knolo runtime and host adapters:

```bash
cargo install --path crates/knolo-agent --bin knolo
pnpm install --frozen-lockfile
pnpm --filter @knolo/agents check
```

For a TypeScript agent definition, see
[`examples/typescript/complete.ts`](../examples/typescript/complete.ts). For
portable packs and native policy examples, see
[`examples/packs/`](../examples/packs/).

### Model-backed execution

Knolo Agent accepts OpenAI-compatible model endpoints. Credentials remain in
the environment; Knolo stores only the name of the environment variable:

```bash
knolo model add local \
  --provider ollama \
  --model qwen2.5-coder:7b \
  --base-url http://127.0.0.1:11434/v1
knolo agent set-model coding-agent local
knolo run --agent coding-agent "inspect the workspace and summarize the next steps"
```

The model proposes work; Knolo Agent remains responsible for policy, approvals,
tool execution, budgets, observations, and termination.

Product-originated tool requests cross the
`crates/integration/knolo-governed-adapter` seam first. That adapter performs
only stable `ToolCallV1` normalization and contract validation; the native
Knolo host remains responsible for compiled pack policy, approvals, execution,
and effect receipts.

### Agent run lifecycle

An agent run follows a bounded control-plane lifecycle:

1. A profile gives the agent a role, mission, working style, and success
   criteria.
2. The runtime turns the user's request into a plan containing proposed
   actions.
3. Policy checks each action against the profile's capabilities, workspace,
   memory scopes, budgets, and approval state.
4. The selected host or adapted product component performs the action.
5. The runtime records the observation, retries only permitted failures, and
   verifies the result.
6. The run terminates with a structured report, or pauses so it can be approved,
   resumed, or stopped safely.

The same lifecycle supports coding, research, and operations profiles. The
profile and granted capabilities change; the execution and audit boundary does
not.

## What this runtime contributes

The implementation source provides the full product capabilities behind Knolo Agent:

- interactive terminal rendering and session UI;
- agent lifecycle, conversation state, compaction, and model turns;
- workspace discovery, file operations, VCS/worktrees, search, and PTY control;
- tools, MCP/ACP adapters, hooks, plugins, sandboxing, and session persistence;
- headless operation, diagnostics, crash handling, and test support.

Knolo Agent exposes these capabilities through explicit contracts and policy
boundaries. Profiles describe mission and role, while packs and host policy
grant tools, workspaces, credentials, memory, and process authority.

## Implementation source

The implementation source has its own Cargo workspace and pinned toolchain. Its
development packages retain historical crate identifiers required for
provenance and dependency compatibility:

```bash
cargo check -p xai-grok-pager-bin
cargo test -p xai-grok-config
cargo build -p xai-grok-pager-bin --release
```

The resulting development binary is `xai-grok-pager`; the supported product
executable is `knolo`. The two names must not be treated as interchangeable.

The parent workspace checks are:

```bash
cargo fmt --all --check
cargo test --workspace
pnpm --filter @knolo/agents check
```

The implementation workspace remains isolated from the parent Cargo workspace
because it has a separate dependency graph and provenance boundary. The parent
Knolo runtime remains authoritative for portable contracts, policy, packs,
events, checkpoints, replay, and host-effect authorization; the system's
product surfaces must consume those boundaries rather than create a parallel
authority model. ICP is an optional deployment adapter alongside local/server
and other hosts.

## Product naming and documentation

The customer-facing product name is **Knolo Agent**. The public executable is
`knolo`. Historical crate, binary, configuration, and dependency names remain
only where required by implementation provenance and are not product branding.

User-facing installation and CLI behavior are documented in the parent
[`docs/`](../docs/). This README documents the product boundary and the
implementation source represented by this directory.

## Legal and provenance

This source includes adapted and third-party material. The Apache-2.0 license,
copyright statements, `THIRD-PARTY-NOTICES`, vendored licenses, and source
revision record are retained as required legal and provenance artifacts. They
are not product branding and must not be deleted from a distributed build.
See [`PROVENANCE.md`](PROVENANCE.md) and [`LEGAL/README.md`](LEGAL/README.md).
