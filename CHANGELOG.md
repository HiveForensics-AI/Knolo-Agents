# Changelog

All notable changes to this workspace are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/) for
published artifacts (`knolo-agent`, `knolo-agent-core`, `@knolo/agents`).
Workspace-only crates (for example `knolo-agent-icp`, `knolo-agent-wasm`) are
called out explicitly and may evolve without a crates.io release.

## [Unreleased]

## [0.2.1] - 2026-09-05

### Fixed

- Crate and npm `repository` / `homepage` URLs now point at the public GitHub
  repository, so crates.io and npm README documentation links resolve.

## [0.2.0] - 2026-09-05

### Added

#### Universal harness conversion (start)

- Product overlay: `@knolo/agents` becomes an additive universal harness around
  the preserved L3 graph runtime. Package names are unchanged.
- Contract: assurance levels L0–L3, lifecycle, authority intersection, and
  freeze point.
- **ICP is an adapter, not harness core.** `IcpAgentRuntimeClient` stays as the
  low-level client; the harness reaches a canister only through `icpAgent()`.
  `Agent.load` engines remain `"typescript" | "wasm"`.
- Core peer: `@knolo/core` **`^5.1.0`** (optional). V5 adapters under
  `packages/agents/src/core-v5/` wrap Knowledge Images, Cortex, ClaimGraph,
  durable runs, authority, evidence, and diagnostics. Legacy
  `CortexCapability` / `ClaimGraphCapability` remain.
- ACS baseline runner and three dummy-agent fixture suites under
  `contracts/fixtures/harness/acs/`.
- Compatibility freeze of do-not-delete public APIs:
  [`docs/compatibility.md`](docs/compatibility.md).
- `createHarness` / `HarnessSession` with `TaskV1`, deterministic middleware
  hooks, and `HarnessRunReceiptV1` (no Hub, no ICP types in harness core).
- First-party `AgentAdapter` factories in `@knolo/agents`: `callableAgent`,
  `httpAgent` (host `fetch`), `processAgent` (explicit argv, no shell),
  `toolAwareAgent`, `nativeKnoloAgent`, and `icpAgent()` over
  `IcpAgentRuntimeClient`.
- Deterministic `compileContext` / `ContextSelectionReceiptV1`: lexical-first
  evidence, Cortex memory recall, redundancy filter, budget priority
  (evidence > constraints > skills > memories). Required evidence never
  drops silently. Optional semantic rerank is recorded as a non-deterministic
  external effect.
- Local skills (no Hub): `SkillDefinitionV1`, `CapabilityIndex` over existing
  `.knolo` JSON metadata, deterministic `resolveSkills`, and
  `SkillSelectionReceiptV1`. Skills whose required capabilities are not in
  effective authority are denied. Trust defaults to `registry: disabled`.
- Optional Hub registry: `PackRegistryCapabilityV1` with `memoryPackRegistry`
  (tests) and `httpPackRegistry` (host `fetch`). Manifest GET + direct Blob
  download + SHA-256. Yanked versions fail closed (HTTP 410). Tokens never
  go to Blob. Reads existing `knolo.lock.json`; mixed registries fail
  closed without force. Offline mode is pinned cache only.
- `HarnessDependencyRootV1` / `PackDependencyV1`: canonical CBOR digest of the
  frozen pack set, bound to the run receipt. Newly pulled packs stage for the
  next run only; the active set cannot change mid-run.
- Auto skill acquisition (`0.6` slice): `acquireSkills` fills unsatisfied
  `task.requiredCapabilities` from Hub under `SkillTrustPolicyV1`
  (`disabled` | `discover` | `acquire-approved` | `acquire-any-verified`).
  Hits are ranked deterministically, SHA-256 verified, and **staged** for the
  next run. Acquisition never grants authority. Publish stays `propose-only`.
- Local experience (`0.7` slice): `ExperienceRecordV1` → `LessonCandidateV1`
  → `SkillCandidateV1`. Cortex-compatible append-only recall, promotion
  gates (repeated usefulness, evaluation, provenance, approval). Promoted
  skills are local only. Public Hub publish stays **disabled**.
- Evaluation and recovery (`0.8` slice): ordered `EvaluationSuiteV1` checks
  (contract → artifact → task → optional host semantic judge). Recovery
  classifier (`tool | retrieval | schema | timeout | policy | model | unknown`)
  with bounded retry and graceful partial. ACS scores live harness runs and
  reports baseline vs harnessed composite (launch target ≥ +10% relative
  uplift on the controlled dummy suites).
- Vendor examples (`0.8` slice): thin Grok Build / Grok / OpenClaw adapters
  under `examples/adapters/` consume the same Task / Context / Skill / Registry
  contracts. Generic MCP bridge (`knoloMcpBridge`) in `@knolo/agents` exposes
  `knolo.retrieve`, `knolo.resolve_skills`, and `knolo.evaluate`. Vendor SDKs
  stay out of the published package. Live smoke is `KNOLO_VENDOR_SMOKE` plus
  host keys and is never required for the default unit suite. ICP wrap example
  is `createHarness({ agent: icpAgent({ actor }) })` only. The Claude example
  was replaced by a Grok Build session adapter.
- Capability publishing (`0.9` slice): `buildCapabilityPack` wraps a promoted
  local skill in a Core V5 Knowledge Image (existing `.knolo` metadata, not a
  new format). `publishLearnedSkill` requires usefulness, evaluation,
  provenance, and explicit approval. `propose-only` does not call Hub.
  `authorized` publishes to `PackRegistryCapabilityV1.publish` (fixture Hub in
  tests). Secrets fail closed. A second harness can pull, verify, and pass eval.
- **1.0 freeze (`PR 13`, not a version bump):** freeze classes in
  [`docs/compatibility.md`](docs/compatibility.md) (frozen L3 / stable-on-path
  harness / experimental examples). Migration guide and harness security
  checklist. `knolo-agent-core` parses shared TaskV1, PackDependencyV1,
  HarnessDependencyRootV1 (same canonical CBOR digest as TypeScript), and
  HarnessRunReceiptV1 JSON. Schema/fixture conformance tests.
  `formatAcsReport` renders `AcsHarnessReportV1` as markdown. Native L3 is
  unchanged.
- TypeScript state-snapshot replay: the portable engine records per-revision
  `StateSnapshot` values on `ExecutionReport.snapshots`. `replayDeterministic`
  accepts events or `ReplayTraceV1` (`recordReplayTrace`) and fails closed when
  state diverges even if event kinds still match. Timestamps are ignored.
  Fixture: `contracts/fixtures/replay/portable-counter-trace-v1.json`.
- Portable WASM execute/resume: `knolo-agent-wasm::command` handles `run` /
  `resume` / `continue` for state, routing, and suspension. Node results stay
  host-supplied through `dispatch`. TypeScript `WasmEngine` loops definition
  handlers over that boundary. Tools, retrieval, and durable stores remain
  host-bound. Fixture:
  `contracts/fixtures/conformance/portable-graph-v1.json`.

### Added (prior)

#### ICP agent runtime (Phases 0–4)

- New workspace crate **`knolo-agent-icp`** (`publish = false`): Internet Computer
  canister host for the Knolo control plane (`ic-cdk` 0.17, Candid, `ic-llm` 1.1,
  `ic-cdk-timers` 0.11, `ic-stable-structures` 0.6).
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
  `FUTURE.md` platform target status.
- Root `.gitignore` entries for `.plans/` (local planning notes) and `.dfx/`.

### Notes

- `knolo-agent-icp` is workspace-validated only; not published separately.
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
