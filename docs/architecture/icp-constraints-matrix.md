# ICP constraints matrix (Phase 0)

Measured against Knolo Agents workspace as of 2026-08-03. Update when Wasm
payload or scheduler cost changes.

## Portability audit

| Component | `wasm32-unknown-unknown` | Notes |
| --- | --- | --- |
| `knolo-agent-core` | **Pass** | Deps: serde, serde_json, sha2 only. Uses `std` collections. |
| `knolo-agent` | **Pass** | Scheduler/host traits compile. `FilesystemCheckpointStore` is unused on ICP. |
| `knolo-agent-icp` | **Pass** (Phase 1) | `ic-cdk` 0.17 + candid 0.10; pure engine unit-tested on host. |

**Conclusion:** Pure `no_std` rewrite is not required for ICP.

## Size & limits

| Dimension | Observation / limit | Knolo implication |
| --- | --- | --- |
| knolo-core knowledge canister Wasm (baseline) | ~860 KiB release | Size baseline from sibling project. |
| `knolo-agent-icp` release Wasm (Phase 1) | ~1.20 MiB | Baseline before effects. |
| `knolo-agent-icp` release Wasm (Phase 2) | **~1.52 MiB** (`1592236` bytes) | Includes ic-llm + timers; re-measure after Phase 3. |
| Definition ingress | Soft cap **2 MiB** (`MAX_DEFINITION_BYTES`) | Same order as knolo-core `MAX_PACK_BYTES`. |
| Update instruction limit | Replica-enforced | Prefer `step` slicing + checkpoints for long graphs (Phase 1 supports step budget via engine). |
| Query vs update | Queries free of consensus write | `inspect`, `get_events`, `get_checkpoint`, `health` are queries. |
| Stable memory (Phase 1) | Coarse `stable_save` of definition + executions JSON | Fine for PoC; upgrade to `ic-stable-structures` in Phase 3. |

## Cost / latency (qualitative Phase 0)

| Path | Latency class | Phase |
| --- | --- | --- |
| Pure in-canister steps | Low (local compute) | 1 |
| ic-llm | Medium–high | 2 |
| HTTPS outcalls | High + transform | 2 |
| Inter-canister knowledge `search` | Medium | 2 |

Map Knolo `max_cost_micros` / step / token limits to cycles **observability** in
Phase 2–3; Phase 1 enforces graph `ExecutionLimitsV1` only.

## knolo-core ICP patterns to reuse

| Pattern | Source | Agent reuse |
| --- | --- | --- |
| Controller-gated mutations | `packages/icp-canister` | `load_definition` / `clear_definition` |
| Soft payload size cap | `MAX_PACK_BYTES` | `MAX_DEFINITION_BYTES` |
| Candid DTOs + health | knowledge canister | agent runtime DID |
| dfx custom canister build | `examples/icp-knowledge-canister` | `examples/icp-agent-canister` |
| CLI `knolo icp …` | `@knolo/cli` | Phase 4 for agents |
| pre/post_upgrade snapshot | knowledge canister | Phase 1; improve Phase 3 |

## Risks tracked

| Risk | Phase 0 status |
| --- | --- |
| Wasm size blow-up | Monitor release Wasm of `knolo-agent-icp`; keep effects out of Phase 1. |
| Instruction limit on deep graphs | Step slice + resume; graph `max_steps`. |
| Upgrade of rich state | Phase 3 stable structures. |
| Divergence from native | Shared fixtures + unit tests in `knolo-agent-icp`. |

## Measurement commands

```bash
cargo check -p knolo-agent-core --target wasm32-unknown-unknown
cargo check -p knolo-agent --target wasm32-unknown-unknown
cargo test -p knolo-agent-icp
cargo build -p knolo-agent-icp --target wasm32-unknown-unknown --release
wc -c target/wasm32-unknown-unknown/release/knolo_agent_icp.wasm
```
