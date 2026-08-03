# ICP agent runtime cost guide (Phase 4)

Rough cost model for operating `knolo-agent-icp`. Numbers are order-of-magnitude
guidance for planning; always measure on your replica and workload.

## Cost surfaces

| Surface | Who pays | What drives cost |
| --- | --- | --- |
| Ingress messages | Caller (update) / free (query) | Definition size, start/step/resume frequency |
| Canister compute (instructions) | Cycles | Graph steps, serde, policy checks, effect rounds |
| Stable memory | Cycles | Packs, executions, checkpoints, event logs |
| ic-llm | Cycles | Prompt length, model, call count |
| HTTPS outcalls | Cycles + latency | URL size, response transform, frequency |
| Inter-canister (knowledge / handoff) | Cycles | Payload size, hops, peer work |

Knolo tracks a **dual budget**:

- **Knolo ledger:** steps, tokens, cost_micros, tool calls/units (from packs +
  graph limits).
- **Cycles observation:** best-effort balance deltas around effect resolution
  (`get_budget`).

These are correlated but not identical. Pack policy fails closed on Knolo
budgets; cycles reserve fails closed on `min_cycles_reserve`.

## Query vs update

Prefer **queries** for inspect paths:

- `health`, `inspect`, `get_budget`, `get_limits`, `get_store_stats`
- `list_executions`, `get_events`, `get_checkpoint`, `get_handoff`

Use **updates** only for state changes (`load_definition`, `start_execution`,
`step`, `resume`, `continue_effects`, handoff accept/forward, `set_limits`).

## Step slicing

Deep graphs should not run unbounded in one update:

1. Call `step(execution_id, n)` with a small `n`, or
2. Set `host.auto_continue` so `step_slice` suspensions schedule timers.

Timers cost extra messages but keep each message under instruction limits.

## LLM and tools

| Pattern | Cycles risk | Mitigation |
| --- | --- | --- |
| ic-llm every node | High | Cache results in effect cache; fewer prompts; tighter graph |
| Mock / offline deterministic | Low | Use pure fixtures (`portable-counter`) for CI |
| HTTPS tools | High + non-deterministic | Pack-deny by default; transform + size caps |
| Knowledge `search` | Medium | Bound `limit`; small result payloads |

## Stable memory growth

Phase 3 stores versioned maps for definitions, executions, checkpoints, events,
budget, limits, and handoffs. Growth drivers:

- `max_concurrent_executions` × average record size
- `max_events_per_execution` (oldest events drop when capped)
- Definition JSON (soft cap 2 MiB)

Operators should call `get_store_stats` periodically and clear definitions or
archive off-chain when no longer needed.

## Wasm size

Release Wasm for `knolo-agent-icp` (Phase 3) is approximately **1.80 MiB**
(measure with `wc -c target/wasm32-unknown-unknown/release/knolo_agent_icp.wasm`).
Larger Wasm increases install/upgrade cost; keep optional features gated.

## Operational recipe

1. Load a least-authority definition once (controller).
2. Set `RuntimeLimitsV1` appropriate for tenancy.
3. Set `min_cycles_reserve` above expected upgrade + reply cost.
4. Run with step budgets; monitor `get_budget` after effect-heavy runs.
5. Prefer pure deterministic graphs in automated tests (no LLM cycles).

## Related docs

- [ADR-001](adr-001-icp-agent-runtime.md)
- [Constraints matrix](icp-constraints-matrix.md)
- [Security checklist](icp-security-checklist.md)
- Example: [`examples/icp-agent-canister/`](../../examples/icp-agent-canister/)
