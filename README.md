# Knolo Agents

Knolo Agents is a **universal intelligence and trust harness** with a preserved
**Rust runtime** and **TypeScript SDK**. The in-process graph runtime remains
the highest-assurance (L3) mode: typed graphs describe execution, packs grant
authority, hosts provide effects, and ordered events make replay and auditing
possible.

The conversion adds a compatibility shell around arbitrary agents. A developer
does not have to rebuild an existing agent as a Knolo graph in order to receive
Knolo knowledge, skills, memory, policy, recovery, and evaluation. Wrap a
callable function, HTTP endpoint, process, tool-aware SDK, native `Agent`, or
ICP canister behind `AgentAdapter`.

This repository is intentionally small and independently usable. Runtime
behavior lives in Rust; TypeScript exposes ergonomic builders, a limited
portable engine, and the harness. Provider SDKs, storage backends, and
`@knolo/core` implementations stay outside this workspace. **ICP is an
adapter**, not harness core.

| Artifact | Role | Published |
| --- | --- | --- |
| `knolo-agent-core` | Portable contracts and validation | crates.io (workspace version) |
| `knolo-agent` | Native scheduler, policy, packs, host effects | crates.io (workspace version) |
| `knolo-agent-wasm` | Browser/JSON WASM protocol adapter | workspace-only |
| `knolo-agent-icp` | Internet Computer canister **host** (consumed via `icpAgent()` adapter) | workspace-only |
| `@knolo/agents` | TypeScript builders, engines, harness, adapters (including ICP client) | npm (`0.1.x` → `0.2` conversion) |

Current workspace version line: **0.1.x** moving to **0.2** for the universal
harness conversion (APIs may evolve before 1.0). Existing `Agent.load` apps
need no mandatory rewrite.

---

## Table of contents

1. [Why it is different](#why-it-is-different)
2. [Architecture](#architecture)
3. [Core concepts](#core-concepts)
4. [Agents in depth](#agents-in-depth)
5. [Packs and least authority](#packs-and-least-authority)
6. [Policy, tools, and host effects](#policy-tools-and-host-effects)
7. [Checkpoints, resume, and HITL](#checkpoints-resume-and-hitl)
8. [Replay](#replay)
9. [Retrieval, Cortex, and ClaimGraph](#retrieval-cortex-and-claimgraph)
10. [Multi-agent handoffs](#multi-agent-handoffs)
11. [TypeScript SDK (`@knolo/agents`)](#typescript-sdk-knoloagents)
12. [Rust crates](#rust-crates)
13. [WASM and ICP](#wasm-and-icp)
14. [Quickstart](#quickstart)
15. [Examples](#examples)
16. [Repository layout](#repository-layout)
17. [Development](#development)
18. [Security and compatibility](#security-and-compatibility)
19. [Documentation index](#documentation-index)
20. [Status and limitations](#status-and-limitations)
21. [License](#license)

---

## Why it is different

Knolo Agents is not an all-in-one prompt, chain, or provider integration layer.
Compared with LangChain-style frameworks, more of the execution contract lives
in **explicit data structures** and less in dynamically assembled application
code:

- Graph transitions, state schemas, budgets, and effect boundaries are
  **validated before run**.
- `.knolo` packs are **least-authority policy inputs**, not executable code.
- Tools, retrieval, Cortex, ClaimGraph, clocks, and storage are **injected by
  the host**, not discovered implicitly.
- Rust owns the **authoritative runtime** and deterministic event model.
- TypeScript provides ergonomic graph construction and a **deliberately limited**
  portable engine, with **no silent fallback** between engines.

This fits governed workflows, durable automation, replayable control planes, and
applications that must inspect or constrain agent authority. It is **not** a
replacement for a model provider, vector store, job queue, or application data
layer. It is also **not** a rewrite of third-party agents: the harness wraps
them.

The conversion contract, assurance levels, and ICP-as-adapter boundary:
[docs/universal-harness-contract.md](docs/universal-harness-contract.md).

---

## Architecture

```
┌──────────────────────────────────────────────────────────────────┐
│  Application / host (credentials, tools, storage, @knolo/core)  │
└────────────────────────────┬─────────────────────────────────────┘
                             │ injects effects & capabilities
┌────────────────────────────▼─────────────────────────────────────┐
│  @knolo/agents UNIVERSAL HARNESS (no ICP types in this layer)    │
│  task → context → skills → tools → recovery → eval               │
│                         AgentAdapter                             │
│  builders + TS/WASM engine  │  nativeKnoloAgent  │  icpAgent()   │
└────────────────────────────┬─────────────────────────────────────┘
                             │ shared contracts
┌────────────────────────────▼─────────────────────────────────────┐
│                     knolo-agent-core                             │
│  graphs · state · events · packs · policy · HITL · handoffs      │
│  checkpoints · replay · tools · retrieval · redaction            │
└──────────────────────────────────────────────────────────────────┘

In-process L3: knolo-agent scheduler + TS/WASM engines
Platform host (not harness core): knolo-agent-icp canister, reached via icpAgent()
```

| Layer | Responsibility |
| --- | --- |
| `knolo-agent-core` | Portable contracts, graph/state validation, policy types, events, replay, checkpoints, pack declarations, handoffs, HITL. |
| `knolo-agent` | Native Rust scheduler, host effect boundaries, policy enforcement, pack loading, Cortex/ClaimGraph injection, durable runtime integrations. |
| `knolo-agent-wasm` | Versioned JSON/WASM protocol adapter: inspect plus portable `run` / `resume` / `continue`. Host supplies node results. Not a full host. |
| `knolo-agent-icp` | ICP canister **host** (Phases 0–4). Not a harness subsystem. TypeScript reaches it through `icpAgent()`. |
| `@knolo/agents` | Typed TypeScript builders, deterministic state/routing/suspension engine, explicit WASM integration, harness, adapters (callable / HTTP / process / native / ICP client / MCP bridge). |
| `@knolo/core` | Separate optional peer (`^5.1.0`) owned by the consumer; Knowledge Images, Cortex, ClaimGraph, authority, durable runs. **Never vendored here.** |

The repository does not vendor `@knolo/core`, credentials, retrieval storage, or
provider SDKs. See [docs/universal-harness-contract.md](docs/universal-harness-contract.md),
[docs/architecture/README.md](docs/architecture/README.md), and
[docs/core-boundary.md](docs/core-boundary.md).

### Universal harness

Any compatible agent sits behind `AgentAdapter`. Knolo owns context compilation,
skills, Hub-pinned packs, policy, recovery, and evaluation.

| Level | Surface | First targets |
| --- | --- | --- |
| L0 | input → output | `callableAgent()`, simple CLI / HTTP |
| L1 | tools / MCP | Grok Build / Grok function calling |
| L2 | hooks / checkpoints | OpenClaw plugins, step-aware SDKs |
| L3 | in-process Knolo graph | `nativeKnoloAgent(Agent.load(...))` |

ICP is **not** a fourth harness level. Wrap a canister the same way you wrap
any other remote agent:

```ts
await createHarness({ agent: icpAgent({ actor }), knowledge: ["./company.knolo"] });
```

`Agent.load` engines remain `"typescript" | "wasm"` only.

### Trust boundaries

1. **Untrusted** — graph definitions and pack bytes supplied by authors.
2. **Trusted compiler** — pack → immutable `CompiledPolicyV1`.
3. **Host-owned effects** — tool implementations, network, LLM, storage.
4. **External core** — `@knolo/core` (Cortex / ClaimGraph), if injected.
5. **Durable stores** — checkpoints and event logs (must write atomically).

---

## Core concepts

| Concept | What it is |
| --- | --- |
| **Agent** | A compiled graph + state schema + (optional) pack authority, bound to an engine or host runtime. |
| **Graph** | Versioned nodes, transitions, entry, cycles, and execution limits. |
| **Node** | A unit of work with declared reads/writes and an outcome (`continue`, `route`, `suspend`, `terminate`, `fail`). |
| **State schema** | Typed JSON paths (`String`, `Number`, `Bool`, `Array`, `Object`, `Null`) validated on every snapshot. |
| **State transaction** | A node reads an immutable snapshot and returns a patch against its revision; failures do not partially commit. |
| **Pack (`.knolo`)** | Reviewable authority: capabilities, namespaces, tools, budgets. Not executable code. |
| **Policy** | Compiled grants + budget ledger; every effect is checked before execution. |
| **Event** | Ordered, versioned control-plane record (start, route, suspend, tool call, terminate, …). |
| **Checkpoint** | Durable snapshot bound to graph/pack/policy/implementation/contract hashes. |
| **Handoff** | Multi-agent envelope that projects state and **narrows** authority to a child graph. |
| **HITL** | Human-in-the-loop suspension with expiry, resume schema, and opaque token. |

---

## Agents in depth

An agent is not a free-form chat loop. It is a **validated control-plane program**:

1. **Define** a state schema and nodes (handlers or host-side executors).
2. **Wire** transitions (routes) from non-terminal nodes to successors.
3. **Declare** an entry node and at least one terminal node.
4. **Optionally bind** a pack that must grant every capability the graph needs.
5. **Compile** → content hash used for resume and replay compatibility.
6. **Load** into an engine (`typescript` | `wasm`) or native/ICP host.
7. **Run** from initial state; the scheduler steps nodes, applies patches, emits
   events, and checkpoints before external suspension.

### Node outcomes

Every node returns one of:

| Outcome | Meaning |
| --- | --- |
| `continue` | Apply optional patch; follow the default / continue edge. |
| `route` | Apply optional patch; follow a named transition route. |
| `suspend` | Pause for HITL, host effect, or step-slice; checkpoint first. |
| `terminate` | End the run with a result (and optional final patch). |
| `fail` | Error; may be marked retryable under runtime policy. |

### State transactions

A node sees a **read-only snapshot** at a known revision. It may only write paths
declared on the node. The runtime rejects:

- stale base revisions
- undeclared read/write paths
- type mismatches against the schema
- partial commits when an effect fails

Successful reduction increments the revision once and records provenance
(execution id, node id, event sequence). See
[docs/architecture/state-transactions.md](docs/architecture/state-transactions.md).

### Graph validation

Compilation rejects (among other issues):

- unsupported contract versions
- duplicate or malformed identifiers
- missing entry or terminal nodes
- unreachable nodes
- unknown transition endpoints / duplicate routes
- invalid read/write paths
- non-positive limits

See [docs/architecture/graph-validation.md](docs/architecture/graph-validation.md).

### Execution limits

Graphs carry `ExecutionLimitsV1`:

- `max_steps`
- `max_tokens`
- `max_cost_micros`
- `timeout_ms`

Native packs may also declare `budget.max_steps` / `budget.max_cost_micros`.
Those fields are validated today; full shared ownership with pack policy is
still evolving (see [FUTURE.md](FUTURE.md)). Tool-level resource budgets are
enforced separately via the pack budget ledger.

### What each engine can do

| Capability | TypeScript engine | WASM adapter | Native `knolo-agent` | ICP canister |
| --- | --- | --- | --- | --- |
| State + routing | yes | via host | yes | yes |
| Suspension | yes | via host | yes | yes |
| Tool calls / budgets | host / Rust | host | yes | pack-gated |
| Retrieval | host inject | host | host inject | knowledge or mock |
| LLM | no (host) | host | host | ic-llm |
| Durable checkpoints | host | host | filesystem / inject | stable structures |
| Multi-agent handoff | helpers | — | types + policy | accept/forward |
| Deterministic event replay | control-plane | — | full modes | event log |

Selecting `engine: "wasm"` without an adapter is an error. Engines **never**
silently fall back to another engine.

---

## Packs and least authority

A pack is an **authority declaration**. It grants capabilities, namespaces,
tools (with argument constraints), bindings, and hard resource budgets. The
runtime compiles grants into immutable policy and **denies unauthorized effects
before execution**. Missing grants deny by default.

Example native pack (`examples/packs/basic.knolo`):

```yaml
version: 1
id: examples.basic
authority:
  capabilities: [state.read, state.write]
  namespaces: [examples.basic]
budget:
  max_steps: 4
  max_calls: 1
  max_units: 10
  max_duration_ms: 1000
  max_cost_micros: 100
```

### Loading packs (Rust)

| API | Purpose |
| --- | --- |
| `load_native_pack` / `load_native_pack_file` | Load native `.knolo` authority from bytes or path. |
| `load_agent_native` / `load_agent_native_file` | Bind pack authority to an explicit agent reference (graph/definition overlay). |
| `load_agent` / `load_agent_file` | JSON companion manifest (`.knolo.json`) for development/compatibility. |

Graph and definition references are an **explicit overlay**: pack files own
authority; agent graphs belong to the surrounding core/runtime. Loading fails
before execution when an agent requests a capability or namespace absent from
native authority. Credentials and implementation details never belong in a pack.

Scenario packs under `examples/packs/` intentionally grant only what each demo
needs (`basic`, `tools`, `retrieval`, `checkpoint`, `hitl`, `handoff`,
`replay`, `claims`, `cortex`, `wasm`, …).

Full write-up: [docs/packs.md](docs/packs.md).

---

## Policy, tools, and host effects

### Policy enforcement

Before every effect the runtime validates:

- versioned call contract
- tool allowlist
- namespace and capability binding
- argument contract
- pack constraints
- remaining budget

Usage is charged after execution. Denials are structured (`PolicyDenialV1`) and
auditable. Resume and live replay require fresh explicit authorization. Host
credentials are never serialized into events or checkpoints.

See [docs/policy-enforcement.md](docs/policy-enforcement.md).

### Tools

Tools pair a **serializable definition** with a **host-owned implementation**:

- stable tool id, capability, namespace
- JSON argument/result contracts
- side-effect metadata
- resource usage (`calls`, `units`, `duration_ms`)

Implementations remain outside checkpoints. Unit tests should use deterministic
local fakes and must not access the network.

See [docs/tools.md](docs/tools.md).

### Host injection (Rust)

The native runtime expects the host to supply:

- `NodeExecutor` — per-node logic
- `EventSink` — ordered event emission
- `Clock` — timestamps (injectable; fixed clocks in tests)
- `CheckpointStore` — durable atomic writes
- `ToolRegistry` / tool implementations
- optional Cortex / ClaimGraph / retrieval adapters

---

## Checkpoints, resume, and HITL

### Checkpoints

A checkpoint contains:

- state snapshot (schema id, revision, value, provenance)
- pending node
- event cursor
- accumulated steps / tokens / cost
- artifact hashes: graph, pack, policy, node implementation, contract

Stores must write atomically. The filesystem store uses temp file + rename;
production hosts should provide equivalent durability.

Resume verifies **every** artifact hash before accepting typed input. Stale HITL
tokens or changed authority fail closed.

See [docs/checkpoints.md](docs/checkpoints.md).

### Human-in-the-loop (HITL)

`SuspensionV1` binds:

- reason and requested action
- review context
- expiry (`expires_at_ms`)
- resume schema hash
- artifact hashes
- nonce → opaque resume token

`validate_resume` rejects expired tokens, wrong schema, or non-object input.

---

## Replay

Replay verifies contiguous ordered events and artifact hashes. Modes:

| Mode | Behavior |
| --- | --- |
| `verify_only` | Check history integrity without re-running effects. |
| `mocked_effects` | Re-execute control plane; substitute recorded tool/retrieval results. |
| `live_effects` | Repeat external effects only with **separate** authorization. |

Replay never silently upgrades contracts or bypasses current policy.

TypeScript `Agent.replay` validates event contiguity; `replayDeterministic`
re-runs the portable graph and compares the control-plane trace (excluding
wall-clock timestamps). When given a `ReplayTraceV1` (`recordReplayTrace`), it
also compares per-revision state snapshots and fails closed if values diverge
even when event kinds still match.

See [docs/replay.md](docs/replay.md).

---

## Retrieval, Cortex, and ClaimGraph

### Retrieval

Native retrieval returns `RetrievalResultV1`: ranked evidence with content,
integer score (`score_micros`), and provenance (`source_id`, locator,
content hash). Retrieval is a **policy-gated host capability**, not hidden
prompt augmentation. Persist the result or event reference so replay can use
recorded evidence without repeating external reads.

See [docs/retrieval.md](docs/retrieval.md).

### Cortex and ClaimGraph (`@knolo/core` boundary)

Knolo Agents depends on, but is separate from, `@knolo/core`. That peer may
provide:

- **Cortex** — query and context assembly
- **ClaimGraph** — read and commit of claims (with mutation approval)

This repository only defines **narrow injection interfaces**. It does not
contain core source, storage, credentials, or release process. Consumers install
a compatible `@knolo/core` (`^5.1.0` optional peer on the TypeScript package) themselves.

See [docs/core-boundary.md](docs/core-boundary.md).

---

## Multi-agent handoffs

Subgraph delegation uses `HandoffEnvelopeV1`:

- `destination` — child graph id
- `state_projection` — map of child JSON pointers → parent pointers
- `authority_projection` — capabilities, namespaces, max steps, max cost
- `return_contract` — versioned return shape

Authority must be a **strict narrowing** of parent execution **and** pack
policy. Escalation (extra capability, higher budget, etc.) fails closed
(`AuthorityEscalation`). On ICP, `accept_handoff` / `forward_handoff` implement
the same envelope across canisters.

TypeScript helper: `assertNarrowAuthority(child, parent, pack)`.

---

## TypeScript SDK (`@knolo/agents`)

### Install

```bash
pnpm add @knolo/agents
# optional peer for Cortex / ClaimGraph
pnpm add @knolo/core
```

Requires **Node 20+**. Package manager in this monorepo: **pnpm 9.15**.

### Define and run an agent

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

### Public surface

| Module | Exports (high level) |
| --- | --- |
| `builder` | `stateSchema`, `node`, `terminal`, `transition`, `entry`, `limits`, `defineAgent`, `compile`, `fromPack` |
| `agent` | `Agent.load`, `run`, `stream`, `resume`, `replay`, `replayDeterministic`, `inspect` |
| `engine` | TypeScript engine; WASM engine + `WasmProtocolAdapter` |
| `contracts` | Versioned types: graphs, events, checkpoints, tools, retrieval |
| `cortex` / `claims` | Injection helpers for core capabilities |
| `multi-agent` | `AuthorityV1`, `HandoffEnvelopeV1`, `assertNarrowAuthority` |
| `hitl` | Suspension / resume validation helpers |
| `replay` | Artifact hashes and replay request validation |
| `icp` | `IcpAgentRuntimeClient` + candid-aligned DTOs (low-level client; wrap with `icpAgent()` for the harness) |
| `harness` | `createHarness`, `HarnessSession`, `TaskV1`, run receipts |
| `adapters` | `callableAgent`, `httpAgent`, `processAgent`, `toolAwareAgent`, `nativeKnoloAgent`, `icpAgent` |
| `context` | `compileContext`, selection receipts, evidence/memory sources |
| `skills` | `resolveSkills`, `SkillDefinitionV1`, local `SkillSelectionReceiptV1` |
| `capabilities` | `CapabilityIndex`, pack metadata, `intersectAuthority` |
| `registry` | `memoryPackRegistry`, `httpPackRegistry`, Hub search/resolve/pull |
| `dependencies` | `parseLockfile`, `HarnessDependencyRootV1`, `DependencyActivation` |

### Engine selection

```ts
// Portable deterministic subset (state, routing, suspension)
Agent.load({ definition, engine: "typescript" });

// Requires explicit adapter — never falls back. The adapter `command`
// loop is inspect / run / resume / continue (host node dispatch).
Agent.load({
  definition,
  engine: "wasm",
  wasm: { command: (request) => wasmModule.command(request) },
});
```

Tool calls, retrieval, and durable effects remain host-bound. ICP is a
separate adapter path, not an `Agent.load` engine.

### ICP client (TypeScript) — adapter, not harness core

The low-level canister client is unchanged. The harness does not import it.

```ts
import { IcpAgentRuntimeClient, portableCounterDefinition } from "@knolo/agents";

// actor from @dfinity/agent + your dfx IDL (optional peers)
const client = new IcpAgentRuntimeClient(actor);
await client.loadDefinition(portableCounterDefinition());
const report = await client.startExecution("run-1", {
  schema_id: "counter-state",
  revision: 0,
  value: { count: 0 },
  provenance: null,
});
```

Harness wrap (same `AgentAdapter` slot as `callableAgent`):

```ts
// createHarness({ agent: icpAgent({ actor: client }) })
```

Package README: [packages/agents/README.md](packages/agents/README.md).

---

## Rust crates

### `knolo-agent-core`

Portable, provider-neutral contracts:

- `graph`, `state`, `node`, `event`
- `pack`, `policy`, `tool`, `retrieval`
- `checkpoint`, `replay`, `hitl`, `handoff`
- `redaction`, `contract`, `wasm` protocol types

### `knolo-agent`

Authoritative native runtime:

- `runtime::Scheduler` — step loop, resume, budgets, events
- `pack` — native and JSON pack loading
- `policy` — budget ledger and denial paths
- `tool` / `host` — definitions and registries
- `checkpoint`, `replay`, `hitl`, `retrieval`
- `cortex`, `claims`, `multi_agent` — injection and authority

```rust
// Conceptually: bind graph + schema + executor + sink + clock + store + policy
// then Scheduler::run(execution_id, initial_state, cancelled)
// or Scheduler::resume(checkpoint, cancelled)
```

### `knolo-agent-wasm`

WASM-safe JSON protocol adapter. `inspect` is self-contained. `run` / `resume`
advance portable state, routing, and suspension and return `dispatch` until the
host answers with `continue`. Build:

```bash
cargo check -p knolo-agent-wasm --target wasm32-unknown-unknown
```

### `knolo-agent-icp`

ICP canister embedding `Scheduler` + ICP host effects (not the browser WASM
adapter, and **not** harness core). Workspace-only (`publish = false`).
TypeScript consumes it through `icpAgent()`. Build:

```bash
cargo build -p knolo-agent-icp --target wasm32-unknown-unknown --release
# or
bash scripts/icp/build.sh
```

---

## WASM and ICP

These are **two different** `wasm32-unknown-unknown` products. WASM is the
in-process portable engine adapter. ICP is a **platform host** reached from
the harness only through `icpAgent()`.

| Path | Crate | Role |
| --- | --- | --- |
| Browser / embed JSON protocol | `knolo-agent-wasm` | Thin adapter; no FS/network/clock unless host supplies them |
| Internet Computer host | `knolo-agent-icp` | Full control-plane host: Candid, effects, stable memory, handoffs |

### ICP phases (summary)

| Phase | Delivered |
| --- | --- |
| 0 | ADR, constraints matrix, wasm32 build confirmation |
| 1 | Deterministic scheduler in-canister; load/start/step/resume; events & checkpoints |
| 2 | Pack-gated tools, ic-llm, retrieval (knowledge or mock), timers, budgets |
| 3 | `ic-stable-structures` v1, limits/allowlists, multi-agent handoff, ops queries |
| 4 | DX scripts, TypeScript client, cost & security guides |

Local dfx example: [examples/icp-agent-canister/](examples/icp-agent-canister/).

Architecture docs:

- [ADR-001](docs/architecture/adr-001-icp-agent-runtime.md)
- [Constraints matrix](docs/architecture/icp-constraints-matrix.md)
- [Cost guide](docs/architecture/icp-cost-guide.md)
- [Security checklist](docs/architecture/icp-security-checklist.md)

WASM notes: [docs/wasm.md](docs/wasm.md).

---

## Quickstart

### Prerequisites

- **Rust** 1.78 or newer
- **Node** 20 or newer (TypeScript package)
- **pnpm** 9.15 (via Corepack)
- Optional ICP: `wasm32-unknown-unknown` target, dfx 0.20.x

### Rust

```bash
cargo test --workspace
cargo run -p knolo-agent --example pack_e2e
cargo run -p knolo-agent --example complete
```

`pack_e2e` loads a native pack fixture, proves an allowed and denied tool call,
and checks deterministic control-plane replay.

### TypeScript

```bash
corepack enable
pnpm install --frozen-lockfile
pnpm --filter @knolo/agents check
pnpm --filter @knolo/agents test
```

### ICP (local)

```bash
rustup target add wasm32-unknown-unknown
bash scripts/icp/build.sh
bash scripts/icp/deploy-local.sh
bash scripts/icp/load-definition.sh
# handoff smoke:
cd examples/icp-agent-canister && bash scripts/run-handoff.sh
```

---

## Examples

| Path | Description |
| --- | --- |
| [crates/knolo-agent/examples/pack_e2e.rs](crates/knolo-agent/examples/pack_e2e.rs) | Pack → policy → allowed/denied tool → replay |
| [crates/knolo-agent/examples/complete.rs](crates/knolo-agent/examples/complete.rs) | Cortex, ClaimGraph, handoff, replay request shapes |
| [examples/typescript/complete.ts](examples/typescript/complete.ts) | Full TS walkthrough: graph, tools, retrieval, HITL, WASM inspect |
| [examples/adapters/](examples/adapters/) | Grok Build / Grok / OpenClaw / ICP wrap around the same harness contracts |
| [examples/packs/](examples/packs/) | Scenario packs (minimal grants per scenario) |
| [examples/icp-agent-canister/](examples/icp-agent-canister/) | dfx deploy, deterministic run, handoff smoke |
| [contracts/](contracts/) | JSON schemas and deterministic fixtures |

More context: [examples/README.md](examples/README.md).

---

## Repository layout

```
.
├── crates/
│   ├── knolo-agent-core/     # Portable contracts
│   ├── knolo-agent/          # Native runtime + examples
│   ├── knolo-agent-wasm/     # JSON/WASM protocol adapter
│   └── knolo-agent-icp/      # ICP canister host
├── packages/
│   └── agents/               # @knolo/agents TypeScript package
├── contracts/
│   ├── schemas/              # JSON Schema (tools, retrieval, policy denial)
│   └── fixtures/             # Conformance / policy / execution fixtures
├── examples/
│   ├── packs/                # .knolo authority declarations
│   ├── typescript/           # TS end-to-end sample
│   ├── adapters/             # Grok Build / Grok / OpenClaw / ICP harness wraps
│   └── icp-agent-canister/   # dfx project + fixtures + scripts
├── docs/                     # Architecture and subsystem docs
├── scripts/
│   ├── hygiene.sh
│   ├── check-packs.mjs
│   ├── check-links.mjs
│   └── icp/                  # build, deploy-local, load-definition, init-template
├── AGENTS.md                 # Contributor guide for agents working in-repo
├── CONTRIBUTING.md
├── GOVERNANCE.md
├── SECURITY.md
├── FUTURE.md
└── CHANGELOG.md
```

---

## Development

Contributor conventions are in [AGENTS.md](AGENTS.md) and
[CONTRIBUTING.md](CONTRIBUTING.md).

### Commands

```bash
# Rust
cargo fmt --all --check
cargo check --workspace
cargo test --workspace

# TypeScript
pnpm install --frozen-lockfile
pnpm --filter @knolo/agents check
pnpm --filter @knolo/agents test

# Hygiene (packs, links, etc.)
bash scripts/hygiene.sh
```

### Guidelines

- Keep runtime behavior in **Rust**; keep ergonomic APIs in **TypeScript**.
- Prefer explicit configuration and validation over hidden behavior.
- Add focused, deterministic tests; **no network** in unit tests.
- Update schemas and fixtures together when a contract changes.
- Do not vendor `@knolo/core` or commit secrets, build artifacts, or editor state.
- Preserve public API compatibility unless the change is intentional and documented.

Releases: [docs/releasing.md](docs/releasing.md).

---

## Security and compatibility

### Security model

Validate all versioned input; deny unknown capabilities; constrain arguments and
budgets; redact sensitive event fields; bind resumes to artifact hashes; narrow
handoffs; keep secrets only in host memory.

Report vulnerabilities per [SECURITY.md](SECURITY.md). Broader notes:
[docs/security.md](docs/security.md).

### Compatibility

- Contracts are versioned **independently** of package versions.
- Version 1 readers reject unknown major versions.
- Resume/replay require **exact** artifact hashes.
- Rust: **1.78+**
- TypeScript: **Node 20+**, optional `@knolo/core` **^5.1.0**
- TypeScript and WASM exchange only documented JSON contracts

See [docs/compatibility.md](docs/compatibility.md).

---

## Documentation index

| Topic | Document |
| --- | --- |
| Docs home | [docs/README.md](docs/README.md) |
| Universal harness contract | [docs/universal-harness-contract.md](docs/universal-harness-contract.md) |
| Compatibility / freeze classes | [docs/compatibility.md](docs/compatibility.md) |
| Releases / next publish | [docs/releasing.md](docs/releasing.md) |
| Migration | [docs/migration.md](docs/migration.md) |
| Security (harness checklist) | [docs/security.md](docs/security.md) |
| Architecture overview | [docs/architecture/README.md](docs/architecture/README.md) |
| State transactions | [docs/architecture/state-transactions.md](docs/architecture/state-transactions.md) |
| Graph validation | [docs/architecture/graph-validation.md](docs/architecture/graph-validation.md) |
| Packs | [docs/packs.md](docs/packs.md) |
| Policy | [docs/policy-enforcement.md](docs/policy-enforcement.md) |
| Tools | [docs/tools.md](docs/tools.md) |
| Retrieval | [docs/retrieval.md](docs/retrieval.md) |
| Checkpoints | [docs/checkpoints.md](docs/checkpoints.md) |
| Replay | [docs/replay.md](docs/replay.md) |
| WASM | [docs/wasm.md](docs/wasm.md) |
| Core boundary | [docs/core-boundary.md](docs/core-boundary.md) |
| ICP ADR | [docs/architecture/adr-001-icp-agent-runtime.md](docs/architecture/adr-001-icp-agent-runtime.md) |
| Roadmap | [FUTURE.md](FUTURE.md) |
| Changelog | [CHANGELOG.md](CHANGELOG.md) |

---

## Status and limitations

The project is an early **0.1.x** release converting to a **0.2** universal
harness. Existing L3 graph APIs are frozen (see
[docs/compatibility.md](docs/compatibility.md)).

**Solid today**

- Rust authoritative in-process runtime with pack-constrained policy
- Ordered events, graph hashing, checkpoint artifact binding
- TypeScript portable engine (state, routing, suspension) with explicit engines
- Host-injected tools, retrieval, Cortex, ClaimGraph
- Core V5 adapter boundary (`@knolo/core` ^5.1.0 optional peer)
- ACS baseline runner and recorded dummy-agent scores
- `createHarness` / `HarnessSession` with `AgentAdapter` factories (`callableAgent`, `httpAgent`, `processAgent`, `toolAwareAgent`, `nativeKnoloAgent`, `icpAgent`, `knoloMcpBridge`)
- Deterministic context compiler (lexical evidence, budgeted envelope, selection receipts)
- Local skill resolver (`SkillDefinitionV1`, `CapabilityIndex`, deny-by-default authority)
- Optional Hub registry (`PackRegistryCapabilityV1`, `knolo.lock.json`, offline cache)
- Frozen `HarnessDependencyRootV1` (canonical pack set; next-run staging only)
- Opt-in Hub skill acquisition (`discover` / `acquire-approved` / `acquire-any-verified`); next-run staging; never grants authority
- Local experience → lesson → skill promotion (`memory: true`); Hub publish disabled
- Evaluation suite (contract / artifact / task + optional judge) and recovery classifier
- ACS on live harness runs vs recorded dummy baseline (`compareSuites`, ≥ +10% relative target)
- Vendor examples: Grok Build / Grok / OpenClaw under `examples/adapters/` (same Task / Context / Skill / Registry contracts; live smoke env-flagged)
- Capability publishing: `publishLearnedSkill` builds a Core V5 pack from a promoted local skill, publishes to a fixture Hub, and a second harness can pull it
- 1.0 freeze docs: freeze classes, [migration](docs/migration.md), [harness security checklist](docs/security.md); Rust `knolo-agent-core` parses Task / dependency-root / run-receipt JSON; `formatAcsReport` renders ACS comparison receipts
- TypeScript state-snapshot replay: `replayDeterministic` compares per-revision snapshots and fails closed on state divergence
- Portable WASM execute/resume: `run` / `resume` / `continue` for state, routing, and suspension; host supplies node results
- ICP control-plane **host** Phases 0–4 (workspace-only; harness adapter path)

**Deliberately incomplete / evolving**

- A published **1.0.0** still waits on remaining P0 items in [FUTURE.md](FUTURE.md) (pack-owned run budgets)
- Shared pack ownership of run budgets (`max_steps` / `max_cost_micros` on native packs validated but not yet fully policy-compiled)
- Production multi-agent and live-core examples

Details: [FUTURE.md](FUTURE.md).

---

## License

Apache License 2.0. See [LICENSE](LICENSE).
