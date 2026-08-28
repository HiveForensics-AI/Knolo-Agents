# ADR-001: ICP Deployment Adapter for the Agent Runtime

- **Status:** Accepted as an optional deployment adapter; supersedes the earlier
  ICP-as-primary-product framing
- **Date:** 2026-08-03
- **Context:** Make the Knolo agent control plane deployable on the Internet
  Computer without making ICP, stable memory, or Candid part of the product
  contract.

## Decision

0. **Product position:** `knolo-agent-system` is the full product composition
   layer. `knolo-agent-icp` is one optional deployment adapter alongside local,
   server, browser/WASM, and other host integrations. Product workflows must
   remain usable without ICP.

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

4. **Knowledge coupling:** Loose **Candid** coupling to compatible `knolo-core`
   knowledge services (`search`) is an adapter concern. Without
   `host.knowledge_canister`, retrieval uses a deterministic mock. Do not
   vendor core storage, Knowledge Images, verification, or receipts.

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

9. **Separation from product and WASM:** Browser JSON and ICP integrations remain
   separate adapters. The ICP canister may provide a full host runtime for
   supported deployments, but it is not the product definition and does not
   replace the local/server path or the browser JSON ABI.

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
- Making ICP the default `@knolo/agents` engine or a release blocker for the
  full agent system.
- Rewriting core as pure `no_std`.
- Automatic migration from Phase 1–2 `stable_save` blob format.
- AgentForge registry integration (optional later).
