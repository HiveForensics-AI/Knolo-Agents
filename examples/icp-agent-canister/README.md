# icp-agent-canister

Local `dfx` example for the Knolo **agent runtime** canister
(`crates/knolo-agent-icp`) — Phase 1 control plane + Phase 2 host effects.

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

Unit tests resolve effects with deterministic mocks (no network). Live LLM
requires a reachable LLM canister (mainnet id used by `ic-llm`, or a local
deploy). Without it, pure definitions like `portable-counter` still run.

## Prerequisites

```bash
rustup target add wasm32-unknown-unknown
# dfx 0.20.x recommended
```

From the **repository root**:

```bash
cargo test -p knolo-agent-icp
cargo build -p knolo-agent-icp --target wasm32-unknown-unknown --release
```

## Run (Phase 1 smoke)

```bash
cd examples/icp-agent-canister
TERM=xterm-256color dfx start --background
TERM=xterm-256color dfx deploy
TERM=xterm-256color bash scripts/run-deterministic.sh
```

## Candid surface

| Method | Kind | Purpose |
| --- | --- | --- |
| `health` | query | Ready if definition loaded |
| `inspect` | query | Graph hash, capabilities, limitations |
| `get_budget` | query | Knolo + cycles budget snapshot |
| `load_definition` | update (controller) | JSON agent definition (+ pack/host) |
| `clear_definition` | update (controller) | Clear graph + executions |
| `start_execution` | update | Run + auto-resolve host effects |
| `step` / `resume` | update | Step-slice / HITL / effect resume |
| `continue_effects` | update | Drain pending host effects |
| `get_events` | query | Ordered event log JSON |
| `get_checkpoint` | query | Last checkpoint JSON |

Fixtures:

- `fixtures/portable-counter.definition.json` — pure Phase 1
- `fixtures/host-effects.definition.json` — Phase 2 effect graph (needs LLM for live run)

See `docs/architecture/adr-001-icp-agent-runtime.md` and
`docs/architecture/icp-constraints-matrix.md`.
