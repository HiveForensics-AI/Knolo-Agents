# WASM

`knolo-agent-wasm` is a WASM-safe, versioned JSON protocol adapter. Build with
`cargo check -p knolo-agent-wasm --target wasm32-unknown-unknown`. TypeScript must
select `engine: "wasm"` and provide an adapter; absence is an error and never causes
a fallback. WASM receives no filesystem, network, clock, or credential authority
unless the embedding host explicitly supplies it.

## Portable execute / resume

`command` accepts `{ version: 1, command, graph, schema?, now_ms? }` and returns an
array of responses (`event`, `dispatch`, `report`, `inspection`, `error`).

| Command | Behavior |
| --- | --- |
| `inspect` | Validates the graph. No schema required. |
| `run` | Starts a portable execution. Requires `schema`. Returns `dispatch` for the entry node. |
| `resume` | Re-enters `checkpoint.pending_node` after checking `graph_hash`. |
| `continue` | Applies a host `NodeExecution` (object patch, not a function) and either `dispatch`es the next node or returns `report`. |

Host node handlers stay on the embedding side. Tools, retrieval, and durable
checkpoint stores are not executed inside the adapter. `now_ms` is the only
clock; omit it for deterministic tests (treated as `0`).

The TypeScript `WasmEngine` loops `dispatch` → definition handler → `continue`
until a `report`. Event kinds use `{ "type": "execution_started" }` (same shape
as `@knolo/agents`). Per-revision `snapshots` are included on the report.

Shared fixture: [`contracts/fixtures/conformance/portable-graph-v1.json`](../contracts/fixtures/conformance/portable-graph-v1.json).

## ICP canister Wasm (separate path)

`knolo-agent-icp` is a different `wasm32-unknown-unknown` target: an Internet
Computer **host runtime** (Candid + `ic-cdk`), not the browser JSON protocol.
Build with `cargo build -p knolo-agent-icp --target wasm32-unknown-unknown --release`.
See [ADR-001](architecture/adr-001-icp-agent-runtime.md) and
[examples/icp-agent-canister](../examples/icp-agent-canister/).
