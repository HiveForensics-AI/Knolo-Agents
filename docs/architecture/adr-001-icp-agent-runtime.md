# ADR-001: ICP Agent Runtime Canister

- **Status:** Accepted (Phase 0 / Phase 1 / Phase 2)
- **Date:** 2026-08-03
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

6. **Persistence:** Phase 1–2 use thread-local state + coarse `stable_save` of
   definition + execution records + budget snapshot. Phase 3 migrates to
   `ic-stable-structures` with versioned schemas.

7. **Separation from `knolo-agent-wasm`:** Browser JSON protocol adapter remains
   a separate crate and path. The ICP canister is a full Host runtime, not the
   inspect-only WASM ABI.

## Consequences

- New workspace crate: `crates/knolo-agent-icp` (`publish = false` until stable).
- Candid surface: `load_definition`, `start_execution`, `step`, `resume`,
  `continue_effects`, `inspect`, `get_events`, `get_checkpoint`, `get_budget`,
  `health`.
- Local `examples/icp-agent-canister` for dfx deploy/smoke.
- Conformance: pure deterministic fixtures match native scheduler semantics;
  host-effects fixture covered by unit tests with mocks.

## Non-goals (through Phase 2)

- Mainnet production hardening, full cycles billing product, multi-agent handoff.
- Making ICP the default `@knolo/agents` engine.
- Rewriting core as pure `no_std`.
- Phase 3 stable-structures schema migrations (next).
