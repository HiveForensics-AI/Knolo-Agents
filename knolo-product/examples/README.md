# Knolo Agent examples

Knolo Agent is a governed agent runtime for bounded, inspectable work. The
`knolo` CLI can run an agent locally, while the Knolo Agents platform provides
typed definitions, packs, policy, host adapters, events, checkpoints, and
replay.

The examples below cover the supported standalone installation, platform
integration, model configuration, headless operation, and run lifecycle.

## Choose the right example

| Scenario | Entry point | Result |
| --- | --- | --- |
| Standalone local agent | [Install and run](#standalone-installation) | A local agent profile executes a bounded workspace task. |
| Agent with the platform | [Platform integration](#knolo-agent-with-the-knolo-agents-platform) | Typed definitions and runtime controls work together. |
| Model-backed execution | [Configure a model](#model-backed-execution) | A compatible model proposes work without receiving implicit authority. |
| Automation and CI | [Headless execution](#headless-execution) | A task returns machine-readable output. |
| Runtime lifecycle | [Pause and replay](#pause-resume-and-replay) | A run can be inspected, paused, resumed, replayed, and exported. |

## Standalone installation

Knolo Agent installs as the `knolo` executable. From the repository root:

```bash
sh install.sh
knolo init
knolo agent list
knolo agent create --template coding coding-agent
knolo agent inspect coding-agent
knolo run --agent coding-agent "list the files in this workspace"
```

The default local host supports bounded workspace tasks. Write effects require
explicit approval:

```bash
knolo run --agent coding-agent --yes "write .knolo/example.txt hello from Knolo Agent"
```

The installation destination defaults to `~/.local/bin/knolo`. The complete
installation options are documented in [`../../docs/install.md`](../../docs/install.md).

## Knolo Agent with the Knolo Agents platform

Knolo Agent uses the Knolo Agents platform as its execution and governance
boundary. Rust owns the authoritative runtime. TypeScript provides typed agent
builders and client interfaces. `@knolo/core` is an optional peer for Cortex
and ClaimGraph capabilities.

The workspace checks are:

```bash
cargo install --path crates/knolo-agent --bin knolo
pnpm install --frozen-lockfile
pnpm --filter @knolo/agents check
```

The portable TypeScript example is
[`../../examples/typescript/complete.ts`](../../examples/typescript/complete.ts).
The policy examples are in [`../../examples/packs/`](../../examples/packs/).

## Model-backed execution

Knolo Agent accepts OpenAI-compatible chat-completions endpoints. Credentials
remain in the environment and are never written to the agent configuration:

```bash
knolo model add local \
  --provider ollama \
  --model qwen2.5-coder:7b \
  --base-url http://127.0.0.1:11434/v1
knolo agent set-model coding-agent local
knolo run --agent coding-agent "inspect the workspace and summarize the next steps"
```

The model produces a proposed plan. Knolo Agent controls capabilities,
workspace paths, approvals, budgets, tool execution, observations, and
termination.

## Headless execution

Headless mode returns structured output for scripts and CI:

```bash
knolo run --agent coding-agent --headless "list files"
```

Headless write operations remain denied unless explicitly approved:

```bash
knolo run --agent coding-agent --headless --yes "write .knolo/ci.txt CI run"
```

## Pause, resume, and replay

Each run has a durable session identifier. Session commands expose lifecycle
control and audit data:

```text
request → profile → plan → policy check → approved action
                                      ↓
                         observe → verify → report
                                      ↓
                              pause / resume / stop
```

```bash
knolo session pause <run-id>
knolo session resume <run-id>
knolo session replay <run-id>
knolo session export <run-id>
```

Replay shows the recorded observation timeline. Export produces the complete
session JSON for inspection or downstream processing.

## Agent model

An agent is a bounded worker, not an unrestricted chat loop:

1. The profile defines mission, role, style, success criteria, and limits.
2. The runtime creates a plan from the user request.
3. Policy checks each action against capabilities, scopes, budgets, and approval.
4. A host executes the approved action.
5. The runtime records observations and verifies the result.
6. The session terminates with a structured report or pauses for controlled
   continuation.

The same execution boundary supports coding, research, and operations agents;
only the profile and granted capabilities differ.

## Runtime integration boundary

Capabilities such as workspace access, terminal execution, sessions, plugins,
and model providers are host effects. They become Knolo Agent capabilities only
when exposed through a typed host boundary and governed by policy:

```text
profile → pack and policy → host adapter → approved effect
                                      ↓
                         event → checkpoint → report
```

The adapter contract includes input validation, workspace and process limits,
credential handling, cancellation, stable observations, and deterministic
allowed/denied tests. A capability never receives authority merely because it
is installed.

## Implementation verification

The implementation source is maintained in a separate Cargo workspace. Its
historical package identifiers are retained for provenance; the public product
executable remains `knolo`.

```bash
cargo fmt --all --check
cargo check --workspace
cargo test --workspace
cargo check --manifest-path knolo-product/Cargo.toml -p xai-grok-pager-bin
cargo test --manifest-path knolo-product/Cargo.toml -p xai-grok-config
```

The implementation workspace is not a second public CLI. Product installation,
CLI behavior, and platform contracts are documented in the parent
[README](../../README.md), [installation guide](../../docs/install.md), and
[CLI guide](../../docs/cli.md).
