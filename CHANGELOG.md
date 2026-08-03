# Changelog

All notable changes to this workspace are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/) for
published artifacts (`knolo-agent`, `knolo-agent-core`, `@knolo/agents`).
Workspace-only crates (for example `knolo-agent-icp`, `knolo-agent-wasm`) are
called out explicitly and may evolve without a crates.io release.

## [Unreleased]

### Added

#### ICP agent runtime (Phases 0–2)

- New workspace crate **`knolo-agent-icp`** (`publish = false`): Internet Computer
  canister host for the Knolo control plane (`ic-cdk` 0.17, Candid, `ic-llm` 1.1,
  `ic-cdk-timers` 0.11).
- **Phase 0 — discovery**
  - Architecture decision record:
    [`docs/architecture/adr-001-icp-agent-runtime.md`](docs/architecture/adr-001-icp-agent-runtime.md)
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
- Documentation cross-links in README, architecture index, WASM notes, and
  `FUTURE.md` platform target status.
- Root `.gitignore` entries for `.plans/` (local planning notes) and `.dfx/`.

### Notes

- `knolo-agent-icp` is workspace-validated only; not published separately.
- Browser `knolo-agent-wasm` remains a separate path from the ICP canister host.
- Live LLM runs require a reachable LLM canister; pure deterministic graphs run
  without it.
- Phase 3+ (not in this change): `ic-stable-structures`, production hardening,
  multi-agent handoff, DX/CLI templates.

### Unchanged published crates

- No intentional public API changes to `knolo-agent`, `knolo-agent-core`, or
  `@knolo/agents` in this branch; version numbers remain as on `main` / prior
  release line until a coordinated publish.
