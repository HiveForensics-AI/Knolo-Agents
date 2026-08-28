# Knolo product user guide

The supported Knolo installation and usage instructions live in the parent
repository:

- [`README.md`](../../../../../../README.md) — product overview and complete
  quickstart;
- [`docs/cli.md`](../../../../../../docs/cli.md) — CLI commands, profiles,
  tasks, approvals, sessions, and planner adapters;
- [`docs/migration/README.md`](../../../../../../docs/migration/README.md) —
  harness extraction and productization phases.

## Current supported CLI flow

```bash
cargo install --path crates/knolo-agent --bin knolo
knolo init
knolo agent list
knolo agent create --template coding my-coder
knolo run --agent my-coder "list files"
knolo run --agent my-coder --headless "read README.md"
```

The TUI, ACP, MCP, model, workspace, and session features in this directory are
implementation material being adapted into Knolo. They are not independently
released or configured through upstream accounts. Until an adapter is wired to
the Knolo contracts, use the parent CLI and its documented host boundaries.

Required source licenses and third-party notices remain in the runtime tree;
they are legal artifacts, not product instructions.
