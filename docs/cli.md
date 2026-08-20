# Knolo CLI

The native CLI is the product entry point for local agent profiles and bounded
task execution. Build or install it from the existing `knolo-agent` crate:

```bash
cargo install --path crates/knolo-agent --bin knolo
knolo --version
```

For development, use `cargo run -p knolo-agent --bin knolo -- ...`.

## First run

```bash
knolo init
knolo doctor
knolo agent list
knolo agent create --template coding my-coder
knolo agent inspect my-coder
```

Profiles are stored under `.knolo/agents` and model definitions under
`.knolo/models` by default. Set `KNOLO_HOME` to use a different data directory.
Built-in profiles are `coding`, `research`, and `operations`; `custom` profiles
can be created from the CLI and then edited as versioned JSON.

Built-in profiles receive read-only memory scopes. A custom profile must
explicitly declare a matching `memory_scopes` entry with `can_write: true`
before `knolo memory add` can persist anything.

`knolo doctor` checks the local Knolo directories and, when a model is
configured, probes its OpenAI-compatible `/models` endpoint without sending a
task. Use `knolo doctor --model <model-id>` to select a specific configuration.

## Choose a model

Knolo uses an OpenAI-compatible chat-completions adapter. This supports local
servers such as Ollama, LM Studio, llama.cpp, and vLLM, as well as compatible
cloud endpoints:

```bash
knolo model add local \
  --provider ollama \
  --model qwen2.5-coder:7b \
  --base-url http://127.0.0.1:11434/v1
knolo model list
knolo agent create --template coding --model local my-coder
```

Secrets are never saved by Knolo. For a credentialed endpoint, pass the name
of an environment variable with `--api-key-env`.

## Memory

Memory is scoped by profile and namespace. The current local adapter is a
development host store; Cortex and ClaimGraph remain the authoritative Knolo
Core integration target.

    knolo memory list my-coder
    knolo memory add my-coder --namespace agent/coding --source cli "project convention"

Built-in profiles are read-only by default, so the second command is expected
to fail until a custom profile explicitly grants memory writes.

## Run a task

The current local host supports deterministic workspace tasks:

```bash
knolo run --agent coding "list files"
knolo run --agent coding "read README.md"
knolo run --agent coding --yes "write .knolo/example.txt hello from Knolo"
knolo run --agent coding --headless "list files"
knolo session pause <run-id>
knolo session resume <run-id>
knolo session replay <run-id>
knolo session export <run-id>
```

An agent with a configured model runs through the model adapter automatically:

```bash
knolo run --agent my-coder "inspect the workspace and report what needs attention"
```

An external planner remains available for custom providers or experimental
orchestration:

```bash
knolo run --agent coding --plan-command ./my-knolo-planner "fix the failing tests"
```

The planner receives a JSON object containing `profile` and `context` on stdin
and must return a `TaskPlanV1` JSON object on stdout. The CLI does not invoke a
shell for this adapter. The Knolo runtime still approves and executes every
returned action.

Write actions require approval in interactive mode. `--yes` explicitly approves
them; headless runs deny writes unless `--yes` is supplied. Workspace paths are
constrained to the current directory and parent traversal is rejected.

The task runner is bounded by profile autonomy limits and returns a structured
report containing status, action count, turns, observations, changed resources,
verification commands, memory items used, and unresolved issues. Additional
providers, remote workspaces, and tools continue to use explicit host adapters
behind the same `TaskHost` contract.

Pause creates a durable pause marker and stops at the next safe loop boundary.
Resume removes that marker and continues the requested task under the same
profile limits. Stop remains the emergency cancellation path. Replay prints
the recorded observation timeline; export prints the complete session JSON.

## Product boundary

The CLI uses the same profile and policy concepts as the Rust runtime and
TypeScript SDK. It is intentionally not a second authority system: future model
and tool adapters must continue to use explicit capabilities, approvals,
budgets, and auditable task observations.
