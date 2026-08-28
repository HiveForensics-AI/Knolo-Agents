# icp-agent-canister

Local `dfx` example for the Knolo **agent runtime** canister
(`crates/knolo-agent-icp`) — Phases 1–3 control plane, host effects, and
upgrade-safe stable memory.

## What works

**Phase 1 (always, offline-friendly)**

- deterministic graph execution
- ordered events, checkpoints, resume / step slicing

**Phase 2 (effects)**

- pack-gated tools (`echo`, optional `https_get`)
- LLM via **ic-llm** (`await_llm` suspend → inter-canister prompt → resume)
- retrieval via knolo-core knowledge canister principal (or mock without one)
- timers for `auto_continue` on `step_slice`
- cycles observation + Knolo budget snapshot (`get_budget`)

**Phase 3 (persistence & hardening)**

- `ic-stable-structures` versioned schemas (packs meta, executions, checkpoints,
  events, budget, limits, handoffs)
- runtime limits / allowlists (`set_limits`, `get_limits`)
- multi-agent handoff (`accept_handoff`, `forward_handoff`, `get_handoff`)
- store stats (`get_store_stats`, `list_executions`)

Unit tests resolve effects with deterministic mocks (no network). Live LLM
requires a reachable LLM canister. Without it, pure definitions like
`portable-counter` still run.

## Prerequisites

```bash
rustup target add wasm32-unknown-unknown
# dfx 0.20.x recommended
```

From the **repository root**:

```bash
cargo test -p knolo-agent-icp
bash scripts/icp/build.sh
# or:
cargo build -p knolo-agent-icp --target wasm32-unknown-unknown --release
```

## Run (Phase 1 smoke)

```bash
cd examples/icp-agent-canister
TERM=xterm-256color dfx start --background
TERM=xterm-256color dfx deploy
TERM=xterm-256color bash scripts/run-deterministic.sh
```

Or from repo root:

```bash
bash scripts/icp/deploy-local.sh
bash scripts/icp/load-definition.sh
```

## Handoff smoke (Phase 3)

After definition is loaded:

```bash
TERM=xterm-256color bash scripts/run-handoff.sh
```

## Scaffold a new dfx project

```bash
bash scripts/icp/init-template.sh ./my-agent-canister
# edit dfx.json paths → build → deploy
```

## TypeScript client

`@knolo/agents` exports `IcpAgentRuntimeClient` and candid-aligned DTO types.
Wire an actor from `@dfinity/agent` (optional peer) to the canister IDL, then:

```ts
import { IcpAgentRuntimeClient, portableCounterDefinition } from "@knolo/agents";

const client = new IcpAgentRuntimeClient(actor);
await client.loadDefinition(portableCounterDefinition());
const report = await client.startExecution("run-1", {
  schema_id: "counter-state",
  revision: 0,
  value: { count: 0 },
  provenance: null,
});
```

## Candid surface

| Method | Kind | Purpose |
| --- | --- | --- |
| `health` | query | Ready if definition loaded |
| `inspect` | query | Graph hash, capabilities, schema version |
| `get_budget` | query | Knolo + cycles budget snapshot |
| `get_limits` | query | Runtime DoS / auth limits |
| `get_store_stats` | query | Stable structure counts |
| `list_executions` | query | Execution ids |
| `load_definition` | update (controller) | JSON agent definition (+ pack/host) |
| `clear_definition` | update (controller) | Clear graph + executions |
| `set_limits` | update (controller) | Configure concurrent/event/auth limits |
| `start_execution` | update | Run + auto-resolve host effects |
| `step` / `resume` | update | Step-slice / HITL / effect resume |
| `continue_effects` | update | Drain pending host effects |
| `accept_handoff` | update | Validate envelope + start local run |
| `forward_handoff` | update | Inter-canister handoff to peer runtime |
| `get_handoff` | query | Handoff audit record |
| `get_events` | query | Ordered event log JSON |
| `get_checkpoint` | query | Last checkpoint JSON |

Fixtures:

- `fixtures/portable-counter.definition.json` — pure Phase 1
- `fixtures/host-effects.definition.json` — Phase 2 effect graph
- `fixtures/handoff.envelope.json` + `handoff-parent.authority.json` — Phase 3

## Docs

- [`docs/architecture/adr-001-icp-deployment-adapter.md`](../../docs/architecture/adr-001-icp-deployment-adapter.md)
- [`docs/architecture/icp-constraints-matrix.md`](../../docs/architecture/icp-constraints-matrix.md)
- [`docs/architecture/icp-cost-guide.md`](../../docs/architecture/icp-cost-guide.md)
- [`docs/architecture/icp-security-checklist.md`](../../docs/architecture/icp-security-checklist.md)
