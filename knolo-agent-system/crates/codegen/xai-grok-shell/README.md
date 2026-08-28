# Knolo session runtime component

This source component contains long-running session and agent runtime material
used by Knolo Agent. It is not a separate
user-facing CLI and it must not advertise upstream authentication, telemetry,
installers, model endpoints, or branding.

## Use Knolo Agent

From the parent repository, install and use the public CLI:

```bash
cargo install --path crates/knolo-agent --bin knolo
knolo init
knolo agent list
knolo agent create --template coding my-coder
knolo run --agent my-coder "list files"
```

For JSON automation:

```bash
knolo run --agent my-coder --headless "read README.md"
```

Write actions require explicit approval. Model-backed planning is provided by a
host adapter using `--plan-command`; the adapter receives a JSON profile/context
request on stdin and returns a Knolo `TaskPlanV1` on stdout. Credentials remain
inside that adapter.

## Component role

The code here runs behind Knolo Agent’s existing:

- `knolo-agent-core` contracts and versioned events;
- pack and policy authority checks;
- checkpoints, replay, cancellation, and budgets;
- host-injected model, tool, workspace, memory, and storage effects;
- `@knolo/agents` and CLI product surfaces.

Historical internal crate names remain temporarily where they reduce extraction
risk. They are not public package or product names. Do not add a direct effect
or provider call here without a corresponding Knolo capability, pack grant,
approval rule, audit event, and deterministic test.

## Building this component

The harness closure has its own generated workspace. Run targeted checks only:

```bash
cargo check -p xai-grok-shell
cargo test -p xai-grok-shell
```

The supported product checks run from the parent workspace as documented in the
parent README. See the root `knolo-agent-system/README.md` and `PROVENANCE.md` for
the implementation boundary and legal requirements.
