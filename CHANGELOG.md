# Changelog

All notable changes to this workspace are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/) for
published artifacts (`knolo-agent`, `knolo-agent-core`, `@knolo/agents`).
Workspace-only crates (for example `knolo-agent-icp`, `knolo-agent-wasm`) are
called out explicitly and may evolve without a crates.io release.

## [Unreleased]

### Changed

- Renamed the full Grok-derived product workspace from `knolo-product/` to
  `knolo-agent-system/` while preserving its provenance and independent Cargo
  workspace.
- Clarified that `knolo-agent-system/` is the product composition layer and
  `knolo-agent-icp`/`knolo-agent-wasm` are optional deployment adapters.
- Updated the integration plan for published `@knolo/core` V5 with V4
  migration compatibility: core remains authoritative for Knowledge Images,
  evidence identity, verification, retrieval plans/receipts, Cortex, and
  ClaimGraph; agent runtime orchestration remains here.
- Renamed ADR-001 to make the ICP deployment-adapter decision explicit.

### Added

- State-level deterministic replay for the TypeScript engine, including
  versioned state snapshots and snapshot-aware replay verification.
- Versioned `EffectReceiptV1` records with explicit tool retry classes,
  idempotency keys, redacted output fields, and native host audit coverage.
- `knolo-governed-adapter` in the independent `knolo-agent-system` workspace,
  plus the `xai-grok-agent` binding that normalizes product tool requests into
  validated Knolo `ToolCallV1` candidates.

#### ICP deployment adapter (Phases 0–4)

- New workspace crate **`knolo-agent-icp`** (`publish = false`): Internet Computer
  canister host for the Knolo control plane (`ic-cdk` 0.17, Candid, `ic-llm` 1.1,
  `ic-cdk-timers` 0.11, `ic-stable-structures` 0.6).
- **Phase 0 — discovery**
  - Architecture decision record:
    [`docs/architecture/adr-001-icp-deployment-adapter.md`](docs/architecture/adr-001-icp-deployment-adapter.md)
  - Constraints matrix (Wasm size, portability, knolo-core ICP reuse):
    [`docs/architecture/icp-constraints-matrix.md`](docs/architecture/icp-constraints-matrix.md)
  - Confirmed `knolo-agent-core` and `knolo-agent` build for
    `wasm32-unknown-unknown` without a pure `no_std` rewrite.
- **Phase 1 — minimal PoC**
  - Deterministic in-canister scheduler path using `knolo-agent::runtime::Scheduler`.
  - Candid surface: `health`, `inspect`, `load_definition`, `clear_definition`,
    `start_execution`, `step`, `resume`, `get_events`, `get_checkpoint`.
  - Ordered events, checkpoints, resume, and step-slicing for pure graphs.
  - Local example: [`examples/icp-agent-canister/`](examples/icp-agent-canister/)
    (`dfx` + `scripts/run-deterministic.sh` + portable-counter fixture).
- **Phase 2 — full host adapter + effects**
  - Pack-gated tools (`echo`, optional `https_get`) via Knolo policy + budget ledger.
  - LLM via **ic-llm** with suspend/resume (`await_llm`); deterministic mock in
    native unit tests (network-free).
  - Retrieval via knolo-core knowledge canister principal (`search`) or mock
    fallback when unset.
  - Timers for `host.auto_continue` on `step_slice` suspensions.
  - Cycles observation + Knolo budget snapshot query: `get_budget`.
  - Effect drain API: `continue_effects`.
  - Host-effects fixture and implementation id `host-effects-v1`.
  - Release Wasm size ~1.52 MiB (Phase 2); Phase 1 baseline was ~1.20 MiB.
- **Phase 3 — persistence, hardening, multi-agent handoff**
  - Versioned **`ic-stable-structures`** schema v1: definition, pack meta,
    executions, checkpoints, events, budget, runtime limits, handoffs.
  - Upgrade flush/reload via MemoryManager (Phase 1–2 `stable_save` not migrated).
  - Runtime limits + caller allowlist / controller-only runs (`set_limits`,
    `get_limits`); concurrent execution and event log caps; cycles reserve.
  - Multi-agent handoff: `accept_handoff`, `forward_handoff`, `get_handoff`
    using `HandoffEnvelopeV1` authority narrowing.
  - Ops queries: `get_store_stats`, `list_executions`.
  - Security checklist:
    [`docs/architecture/icp-security-checklist.md`](docs/architecture/icp-security-checklist.md).
  - Release Wasm size ~1.80 MiB (`1882138` bytes).
- **Phase 4 — DX, packaging, ecosystem**
  - Scripts: [`scripts/icp/`](scripts/icp/) (`build`, `deploy-local`,
    `load-definition`, `init-template`).
  - TypeScript client: `IcpAgentRuntimeClient` + candid DTOs in `@knolo/agents`
    (`packages/agents/src/icp/`); optional `@dfinity/*` peers for live actors.
  - Cost guide:
    [`docs/architecture/icp-cost-guide.md`](docs/architecture/icp-cost-guide.md).
  - Handoff fixtures + `scripts/run-handoff.sh` in the dfx example.
- Documentation cross-links in README, architecture index, WASM notes, and
  `FUTURE.md` optional-adapter status.
- Root `.gitignore` entries for `.plans/` (local planning notes) and `.dfx/`.

### Notes

- `knolo-agent-icp` is an optional deployment adapter, workspace-validated only;
  it is not published separately and is not required by the product path.
- Browser `knolo-agent-wasm` remains a separate path from the ICP canister host.
- Live LLM runs require a reachable LLM canister; pure deterministic graphs run
  without it.
- Optional later: factory topology, AgentForge registry, production HTTPS
  transforms, mainnet ops runbooks beyond the checklist.

### Unchanged published crates

- No intentional public API changes to `knolo-agent` or `knolo-agent-core` in
  this branch. `@knolo/agents` gains additive ICP client exports (non-breaking).
  Version numbers remain as on `main` / prior release line until a coordinated
  publish.
