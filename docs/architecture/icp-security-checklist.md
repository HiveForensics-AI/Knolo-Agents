# ICP agent runtime security checklist (Phase 3)

Use this checklist before mainnet deploy of `knolo-agent-icp`. It complements
[`docs/security.md`](../security.md) with canister-specific controls.

## Controllers and callers

- [ ] Controllers are limited to ops principals (not application users).
- [ ] `load_definition`, `clear_definition`, and `set_limits` are controller-only.
- [ ] For public multi-tenant runtimes, either set `allowed_callers` or enable
      `require_controller_for_runs` after bootstrap.
- [ ] Anonymous principal is not in `allowed_callers` unless intentional and
      pack-gated effects cannot drain cycles.

## Packs and policy

- [ ] Production definitions include a least-authority pack (tools, namespaces,
      capability bindings, tool budgets).
- [ ] Tool deny paths are tested with the loaded pack.
- [ ] Graph `ExecutionLimitsV1` (`max_steps`, tokens, cost, timeout) are tight
      enough for the expected workload.

## DoS and ingress

- [ ] `MAX_DEFINITION_BYTES` (2 MiB) remains acceptable for your ingress path.
- [ ] `RuntimeLimitsV1` caps concurrent executions, events per run, state size,
      and handoff envelope size.
- [ ] `min_cycles_reserve` is set so residual balance covers upgrades and replies.

## Upgrade safety

- [ ] Stable schema version is known (`get_store_stats` / `inspect.schema_version`).
- [ ] Upgrade path tested on a local replica: load definition → run → upgrade
      Wasm → `list_executions` / `get_events` / `get_checkpoint` still return data.
- [ ] Phase 1–2 `stable_save` snapshots are **not** expected to migrate; redeploy
      or re-load definitions after first Phase 3 install.

## Effects and reentrancy

- [ ] Long LLM / tool / retrieval work goes through suspend → await → resume
      (never unbounded work in one update).
- [ ] `max_effect_rounds` and step budgets bound instruction use per message.
- [ ] HTTPS tools remain disabled unless pack grants and host `allow_https_tools`
      are both true; outcall transforms are reviewed if enabled.

## Multi-agent handoff

- [ ] Handoff envelopes are validated against parent + pack authority (no
      escalation).
- [ ] Destination graph id must match the loaded graph on the accepting canister.
- [ ] Inter-canister `forward_handoff` targets are trusted principals only.

## Observability

- [ ] `get_budget` dual view (Knolo steps/tokens/cost + cycles observed) is
      monitored.
- [ ] Ordered events and checkpoints are retained within limits for audit.

## Explicit non-goals (still)

- Full product billing / SaaS metering.
- Making ICP the default `@knolo/agents` engine.
- Browser `knolo-agent-wasm` as the canister binary.
