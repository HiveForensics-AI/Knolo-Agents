# ADR-001: ICP Agent Runtime Canister

- **Status:** Accepted (Phase 0 / Phase 1 / Phase 2 / Phase 3; Phase 4 DX ongoing)
- **Date:** 2026-08-03
- **Harness boundary:** ICP is a **platform adapter / host**, not part of the
  universal harness core. `createHarness` / `HarnessSession` must not import
  this crate or Candid DTOs. TypeScript consumers wrap the canister with
  `icpAgent()` over `IcpAgentRuntimeClient`. See
  [the universal harness contract](../universal-harness-contract.md).
- **Context:** Host Knolo’s deterministic control plane on the Internet Computer.

## Decision

1. **Topology (Phase 1–3):** Single long-lived **multi-tenant agent runtime canister**
   embedding `knolo-agent-core` + `knolo-agent::runtime::Scheduler` and an ICP Host.
   Per-agent factory canisters are deferred until isolation/scaling requires them.

2. **Wasm target:** `wasm32-unknown-unknown` with `std` via `ic-cdk`. Pure `no_std`
   is **not** required. Residual host OS APIs stay out of the hot path; the
   filesystem checkpoint store is never used in the canister.

3. **LLM / effects (Phase 2 landed):** Prefer **ic-llm** (`ic-llm` 1.1 +
   `ic-cdk` 0.17). HTTPS tools are pack-gated and optional. Effect nodes use
   `await_llm` / `await_tool` / `await_retrieve` suspend reasons; the canister
   resolves them asynchronously then resumes.

4. **Knowledge coupling:** Loose **Candid** coupling to knolo-core knowledge
   canisters (`search`). Without `host.knowledge_canister`, retrieval uses a
   deterministic mock. Do not vendor knolo-core storage.

5. **Async model:** Keep the synchronous `NodeExecutor` contract. Map long
   effects to **Suspend → checkpoint → timer/message resume**.
   `host.auto_continue` schedules `ic-cdk-timers` for `step_slice`.

6. **Persistence (Phase 3 landed):** **`ic-stable-structures`** with versioned
   schema (`STABLE_SCHEMA_VERSION = 1`) for definition, pack meta, executions,
   checkpoints, event log entries, budget, runtime limits, and handoffs.
   Hot path keeps an in-RAM `AgentEngine`; mutations flush to stable maps.
   Upgrade path: `pre_upgrade` flush + `post_upgrade` reload. Phase 1–2
   `stable_save` snapshots are not migrated (PoC break is acceptable).

7. **Hardening (Phase 3):** Controller-gated definition/limits mutations;
   optional run allowlist / controller-only runs; concurrent execution caps;
   event log caps; cycles reserve guard; security checklist documented.

8. **Multi-agent handoff (Phase 3):** `accept_handoff` validates
   `HandoffEnvelopeV1` against parent + pack authority (fail closed on
   escalation). Destination must match the loaded graph. `forward_handoff`
   performs inter-canister accept on a peer runtime.

9. **Separation from `knolo-agent-wasm`:** Browser JSON protocol adapter remains
   a separate crate and path. The ICP canister is a full Host runtime, not the
   inspect-only WASM ABI.

10. **DX (Phase 4):** Agents-owned scripts under `scripts/icp/`, dfx example +
    scaffold template, TypeScript `IcpAgentRuntimeClient` in `@knolo/agents`
    (optional `@dfinity/*` peers for live calls), cost and security guides.

## Consequences

- Workspace crate: `crates/knolo-agent-icp` (`publish = false` until stable).
- Candid surface (Phase 3): `load_definition`, `start_execution`, `step`,
  `resume`, `continue_effects`, `inspect`, `get_events`, `get_checkpoint`,
  `get_budget`, `get_limits`, `set_limits`, `get_store_stats`,
  `list_executions`, `accept_handoff`, `forward_handoff`, `get_handoff`,
  `health`.
- Local `examples/icp-agent-canister` for dfx deploy/smoke + handoff.
- Conformance: pure deterministic fixtures match native scheduler semantics;
  host-effects and handoff covered by unit tests (network-free).

## Non-goals

- Mainnet SaaS billing product.
- Making ICP the default `@knolo/agents` engine.
- Rewriting core as pure `no_std`.
- Automatic migration from Phase 1–2 `stable_save` blob format.
- AgentForge registry integration (optional later).
