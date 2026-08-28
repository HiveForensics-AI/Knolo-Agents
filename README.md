# Knolo Agents

Knolo Agents is a governed agent framework for building reliable, inspectable
AI workflows. Rust provides the authoritative runtime and policy boundary;
TypeScript provides ergonomic graph builders and portable clients. The full
interactive product system is included in `knolo-agent-system/` as an isolated
workspace.

Knolo is designed for applications that need bounded execution, explicit
authority, durable state, human approval, and replayable evidence. It is not a
model provider, vector database, job queue, or replacement for application
storage.

## Release surface

| Component | Purpose | Release status |
| --- | --- | --- |
| `knolo-agent-core` | Versioned contracts, graphs, state, events, packs, replay, and policy types | Rust workspace `0.1.1` |
| `knolo-agent` | Native scheduler, policy enforcement, packs, tools, retrieval, and host effects | Rust workspace `0.1.1` |
| `knolo-agent-wasm` | Browser and embed JSON/WASM adapter | Workspace-only |
| `knolo-agent-icp` | Internet Computer deployment adapter | Workspace-only |
| `@knolo/agents` | TypeScript builders, deterministic engine, and explicit host clients | npm `0.1.3` |
| `knolo-agent-system/` | Full Knolo Agent product system and interactive implementation source | Independent Cargo workspace |

`@knolo/core` is a separate dependency boundary. Knolo Agents supports the
published V5 line (`^5.0.0`) and does not copy or vendor its implementation.
V4 is supported only through an explicit legacy adapter; there is no silent
V4 fallback.

## Install

### Install the Knolo CLI from a checkout

Requirements: Rust 1.78+, a Unix-like shell, and a working Cargo installation.

```bash
git clone https://github.com/HiveForensics-AI/Knolo-Agents.git
cd Knolo-Agents
sh install.sh
knolo init
```

The installer places the executable in `~/.local/bin` by default. Set
`KNOLO_INSTALL_DIR` to choose another prefix:

```bash
KNOLO_INSTALL_DIR="$HOME/.local" sh install.sh
```

The supported remote installation form is:

```bash
curl -fsSL https://raw.githubusercontent.com/HiveForensics-AI/Knolo-Agents/main/install.sh | sh
```

The installer accepts `KNOLO_VERSION`, `KNOLO_BINARY_URL`, and
`KNOLO_USE_SOURCE=1` for release selection and source-build control. See the
[installation guide](docs/install.md) for platform and model setup details.

### Install the TypeScript SDK

```bash
pnpm add @knolo/agents
```

The SDK requires Node 20+. `@knolo/core` is optional and is needed only when an
application injects Cortex, ClaimGraph, or other core capabilities:

```bash
pnpm add @knolo/core
```

### Build the full agent system from source

`knolo-agent-system/` is the full product composition layer. It contains the
interactive shell/TUI, session lifecycle, model integration, workspace tools,
sandboxing, MCP/ACP, plugins, and operational surfaces. It is intentionally an
independent Cargo workspace because it has a separate dependency graph and
source/provenance boundary.

From the repository root:

```bash
cargo build --manifest-path knolo-agent-system/Cargo.toml \
  -p xai-grok-pager-bin --release
```

This source workspace currently produces the historical development binary
`xai-grok-pager`; the supported Knolo runtime installation produces `knolo`.
Historical `xai-*` names are retained inside the source workspace where
required for provenance and dependency compatibility. Product actions still
cross the Knolo governed adapter before host effects are executed.

## Quick start

### Run a bounded local agent

```bash
knolo init
knolo agent create --template coding coding-agent
knolo agent inspect coding-agent
knolo run --agent coding-agent "list the files in this workspace"
```

Read-only work can run immediately. Writes require explicit approval:

```bash
knolo run --agent coding-agent --yes \
  "create a short TODO.md describing the next engineering tasks"
```

Use headless mode for automation and CI:

```bash
knolo run --agent coding-agent --headless "summarize the repository"
```

Inspect the resulting session:

```bash
knolo session list
knolo session logs <session-id>
knolo session replay <session-id>
knolo session export <session-id>
```

### Connect an OpenAI-compatible model

Credentials stay in the environment; Knolo stores only the environment
variable name. The same interface works with Ollama, LM Studio, llama.cpp,
vLLM, and compatible cloud endpoints.

```bash
ollama serve
ollama pull qwen2.5-coder:7b

knolo model add local \
  --provider ollama \
  --model qwen2.5-coder:7b \
  --base-url http://127.0.0.1:11434/v1
knolo agent set-model coding-agent local
knolo run --agent coding-agent "inspect the workspace and report what needs attention"
```

Check the environment before a model-backed run:

```bash
knolo doctor
```

The model proposes work. Knolo remains responsible for capability checks,
workspace scope, approvals, budgets, tool execution, observations, and
termination. See the [CLI guide](docs/cli.md) for profiles, sessions, and
approval behavior.

### Define a TypeScript agent

```ts
import {
  Agent,
  defineAgent,
  entry,
  node,
  stateSchema,
  terminal,
  transition,
} from "@knolo/agents";

const state = stateSchema("counter-state", { count: "Number" });

const increment = node("increment", {
  writes: ["count"],
  run: ({ state }) => ({
    outcome: { type: "continue", patch: { count: state.count + 1 } },
  }),
});

const done = terminal("done", {
  run: ({ state }) => ({
    outcome: { type: "terminate", result: state.count },
  }),
});

const definition = defineAgent({
  id: "counter",
  state,
  nodes: [increment, done],
  transitions: [transition("increment", "continue", "done")],
  entry: entry("increment"),
});

const report = await Agent.load({ definition, engine: "typescript" }).run({
  count: 0,
});
console.log(report.status); // { type: "terminated", result: 1 }
```

The TypeScript engine is a deterministic portable subset for state, routing,
and suspension. Select `engine: "wasm"` only with an explicit adapter. Engines
never silently fall back to one another. Tools, retrieval, credentials, and
durable effects remain host-bound.

## Architecture and authority

```text
application / host
  credentials, tools, storage, model provider, @knolo/core
            │ injected effects and capabilities
            ▼
knolo-agent-system │ @knolo/agents │ knolo-agent │ ICP/WASM adapters
            │ governed integration boundary
            ▼
knolo-agent-core
  graphs · state · events · packs · policy · HITL · replay · retrieval
```

The execution boundary is deliberately explicit:

1. A graph defines typed state, nodes, transitions, limits, and an entry point.
2. A pack declares the capabilities, namespaces, tools, and budgets available
   to the graph.
3. Compilation validates the graph and produces an artifact hash.
4. The runtime checks every effect before execution and records ordered events.
5. Checkpoints bind state to graph, pack, policy, implementation, and contract
   hashes before suspension or resume.
6. Replay verifies the control-plane history without silently repeating effects.

Packs are declarations of authority, not executable code. Missing capabilities
are denied by default. Host implementations own network access, files,
credentials, model calls, storage, and external side effects.

### The `@knolo/core` boundary

Applications may inject published Knolo core capabilities such as Cortex,
ClaimGraph, V5 Knowledge Images, verification, and query receipts. The agent
framework preserves evidence identity and receipt metadata but does not own the
core store.

The TypeScript V5 adapter is exported from `@knolo/agents`. Product-originated
requests pass through
`knolo-agent-system/crates/integration/knolo-governed-adapter`; that adapter
normalizes and validates the request, while the native Knolo host continues to
own policy, approvals, execution, and effect receipts.

### Deployment adapters

ICP and browser WASM are deployment targets, not competing products:

| Adapter | Role |
| --- | --- |
| `knolo-agent-wasm` | Small JSON/WASM protocol for browser or embedded hosts |
| `knolo-agent-icp` | Candid, stable-memory, timers, and ICP host effects |
| `@knolo/agents` ICP client | Typed client for an externally deployed canister |

ICP is optional. The full agent system remains the product composition layer.

## Repository layout

```text
crates/knolo-agent-core/   portable contracts and validation
crates/knolo-agent/        native runtime, policy, packs, and host effects
crates/knolo-agent-wasm/   browser/embed adapter
crates/knolo-agent-icp/    optional ICP deployment adapter
packages/agents/           @knolo/agents TypeScript package
contracts/                 schemas and deterministic fixtures
examples/                  Rust, TypeScript, pack, and ICP examples
knolo-agent-system/        full product system, isolated workspace
docs/                      architecture, installation, CLI, security, releases
```

## Examples and documentation

- [Examples](examples/README.md) — deterministic Rust and TypeScript workflows
- [Installation and model setup](docs/install.md)
- [CLI guide](docs/cli.md)
- [Architecture](docs/architecture/README.md)
- [Full agent system](knolo-agent-system/README.md)
- [TypeScript package](packages/agents/README.md)
- [Packs and policy](docs/packs.md), [tools](docs/tools.md), and
  [retrieval](docs/retrieval.md)
- [Checkpoints](docs/checkpoints.md) and [replay](docs/replay.md)
- [Core boundary](docs/core-boundary.md) and [compatibility](docs/compatibility.md)
- [Release process](docs/releasing.md)
- [Roadmap](FUTURE.md) and [changelog](CHANGELOG.md)

## Development

Use the committed pnpm lockfile and the package manager declared in
`package.json`. Unit tests are deterministic and must not require network
access.

```bash
# Rust workspace
cargo fmt --all --check
cargo check --workspace
cargo test --workspace

# TypeScript package and examples
pnpm install --frozen-lockfile
pnpm --filter @knolo/agents check
pnpm --filter @knolo/agents test
pnpm --filter @knolo/agents exec tsc -p ../../examples/tsconfig.json --noEmit

# Repository hygiene
bash scripts/hygiene.sh
```

Changes to the imported product workspace should be validated narrowly: test
the governed adapter and any intentionally changed bridge, not the entire
unchanged upstream-derived suite. Read [AGENTS.md](AGENTS.md) and
[CONTRIBUTING.md](CONTRIBUTING.md) before making changes.

## Compatibility and security

- Rust 1.78+ and Node 20+ are supported baselines.
- Contract versions are independent of package versions.
- Resume and replay require exact artifact hashes.
- Unknown capabilities and malformed versioned inputs fail closed.
- Credentials remain in host memory or environment variables.
- Handoffs may only narrow authority and budgets.
- `@knolo/core` V5 is the supported published line; V4 is legacy and explicit.

Report vulnerabilities using [SECURITY.md](SECURITY.md). Adapted source and
third-party notices are documented in
[knolo-agent-system/PROVENANCE.md](knolo-agent-system/PROVENANCE.md) and
[knolo-agent-system/THIRD-PARTY-NOTICES](knolo-agent-system/THIRD-PARTY-NOTICES).

## License

Apache License 2.0. See [LICENSE](LICENSE).
