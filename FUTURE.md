# Future Work — Knolo Agents

Knolo Agents is an early `0.x` project. The items below are intentional next
steps grounded in the current repository, documented limitations, and remaining
contract gaps. They are not a redesign wishlist, and they are not evidence of
unfinished chaos: the control-plane core already works.

## Current status summary

What is solid today:

- **Rust is the authoritative runtime.** `knolo-agent-core` owns portable
  contracts (graphs, state schemas, events, packs, policy, HITL, handoffs,
  checkpoints, replay requests). `knolo-agent` owns the native scheduler, host
  effect boundaries, pack loading, and durable runtime integrations.
- **Pack-constrained authority is real.** Native `.knolo` declarations and
  `.knolo.json` manifests load into immutable policy; missing grants deny by
  default. Tool resource budgets are enforced before execution.
- **Deterministic control plane basics exist.** Ordered events, graph hashing,
  checkpoint artifact binding, and contiguous-sequence replay verification are
  in place. The TypeScript engine supports the portable subset: state, routing,
  and suspension, with explicit engine selection and no silent fallback.
- **Boundaries are explicit.** Tools, retrieval, Cortex, ClaimGraph, clocks, and
  storage are host-injected. `@knolo/core` is a peer dependency, never vendored.

What is deliberately incomplete: full state-level TypeScript replay, standalone
WASM execution, deeper native pack identity for agent graphs, shared ownership of
run budgets across pack/core contracts, production multi-agent and live-core
examples, evaluation harnesses, and pre-1.0 API freeze work.

## Priority roadmap

### P0 — Highest leverage

#### Stronger TypeScript deterministic replay (full state snapshots)

- **What:** Today `Agent.replay` validates contiguous event sequences, and
  `replayDeterministic` re-executes and compares the control-plane event trace
  (excluding wall-clock timestamps). That is ordering/kind fidelity, not full
  run reconstruction. Extend portable replay so each step can be checked against
  recorded state snapshots (revision, schema id, value, provenance), not only
  event kinds and sequence numbers.
- **Why it matters:** Consumers building on `@knolo/agents` need to audit and
  re-verify local runs without the Rust runtime. Control-plane ordering alone
  cannot catch silent state divergence or incomplete patch application.
- **Rough acceptance criteria:**
  - Replay fixtures record ordered events **and** per-step (or per-revision)
    state snapshots.
  - `replayDeterministic` (or a successor API) fails closed when state diverges
    even if event kinds still match.
  - Tests cover happy path, truncated history, mutated state mid-trace, and
    timestamp-insensitive comparison.
  - Scope stays within the portable engine capabilities (no fake tool/network
    effects inside TypeScript-only replay).

#### Expose run budgets through shared pack / core contracts

- **What:** Graph definitions already carry `ExecutionLimitsV1`
  (`max_steps`, `max_tokens`, `max_cost_micros`, `timeout_ms`), and both engines
  enforce them. Native `.knolo` files may declare `budget.max_steps` and
  `budget.max_cost_micros`, but the native parser only validates those fields
  and discards them: they are not stored on `PackDeclarationV1` and are not
  compiled into pack policy. Tool-level `ResourceBudgetV1` remains separate.
- **Why it matters:** Packs are the least-authority surface. Run budgets that
  exist only as graph/runtime fields can be tightened or loosened outside pack
  review. Shared contract ownership makes authority inspectable and comparable
  across handoffs, packs, and schedulers.
- **Rough acceptance criteria:**
  - `PackDeclarationV1` (and JSON companion) include run-limit fields that map
    cleanly to graph limits, without conflating tool call budgets and step/cost
    budgets.
  - Native parse retains and enforces those fields; malformed or zero budgets
    fail closed before execution.
  - Handoff authority narrowing continues to use the same limit vocabulary.
  - Marked **depends on `@knolo/core` / shared contract alignment** if pack
    schema ownership lives upstream of this repo.

#### Full standalone WASM execution path

- **What:** `knolo-agent-wasm` is a versioned JSON protocol adapter. It accepts
  shared graphs and supports **inspect**; run/resume responses currently fail
  with “execution requires host node dispatch.” TypeScript `engine: "wasm"`
  requires an explicit adapter and never falls back—but the published story is
  still inspection + host-dispatched handlers, not a self-contained portable
  runtime.
- **Why it matters:** Local-first and embeddable hosts need a complete portable
  path that validates graphs, advances state/routing/suspension, and emits the
  same event model without shipping the full native host.
- **Rough acceptance criteria:**
  - WASM protocol handles `run` / `resume` for the portable capability set
    (state, routing, suspension) with host-supplied node results only where the
    contract already requires host effects.
  - Conformance fixtures shared with `knolo-agent-core` pass under
    `wasm32-unknown-unknown` and through the TypeScript WASM adapter.
  - Limitations remain explicit in inspection output; tools/retrieval/durable
    effects stay host-bound.
  - Decide whether `knolo-agent-wasm` remains workspace-validated or becomes a
    separately versioned published artifact (see packaging below).

### P1 — Important before broader adoption

#### Deeper native `.knolo` support for agent graph / definition identity

- **What:** Native packs are first-class for authority (tools, namespaces,
  capabilities, tool-resource budgets). Agent graph and definition references
  remain an **explicit overlay** via `load_agent_native(..., PackAgentReferenceV1)`
  because those definitions are owned by core/runtime. Argument constraints are
  present on the JSON manifest path but not parsed from the current native
  textual format (native loads leave `argument_constraints` empty).
- **Why it matters:** Operators should review one pack artifact that both grants
  authority and names the agent surface it applies to, without a second
  out-of-band overlay when core can supply stable identity.
- **Rough acceptance criteria:**
  - Optional native fields (or a companion core-owned binary store feed) can
    supply graph/definition references without moving policy enforcement into
    agents.
  - Overlay remains supported for development; when both are present, native
    authority wins and conflicts fail closed.
  - Native packs can express the same tool argument constraints the JSON path
    already supports.
  - **Depends on `@knolo/core` / `knolo-core-rust` binary store work** as
    documented in `docs/packs.md`; agents keep the `PackDeclarationV1` boundary.

#### Production-quality examples (HITL, suspend/resume, multi-agent, host effects)

- **What:** `examples/packs/` covers small named scenarios; Rust has
  `pack_e2e` and a thin `complete` host-boundary demo; TypeScript
  `examples/typescript/complete.ts` exercises interfaces with mocks. Runnable
  end-to-end stories for HITL approval loops, durable checkpoint resume, real
  host tool injection, and multi-agent handoff **execution** (not only envelope
  validation) are still thin. `examples/rust/` is currently empty.
- **Why it matters:** Adoption depends on copy-pasteable, fail-closed examples
  that match production trust boundaries—not interface sketches.
- **Rough acceptance criteria:**
  - At least one runnable Rust example per major host concern: tools+policy,
    HITL suspend/resume with artifact hashes, multi-agent narrowed handoff,
    checkpoint store round-trip, deterministic replay of a real event log.
  - TypeScript example(s) that resume from a checkpoint and demonstrate
    pack-gated definition compilation without inventing provider SDKs.
  - Each example uses a least-authority pack from `examples/packs/` and
    documents expected deny paths.

#### Richer multi-agent patterns and ClaimGraph collaboration

- **What:** Handoff contracts (`HandoffEnvelopeV1`, authority narrowing) and
  ClaimGraph injection (`ClaimGraphCapability`, explicit mutation approval)
  exist. What is missing are shared, inspectable multi-agent **patterns**:
  parent→child→return flows with projected state, collaborative claim
  proposals with dual approval, and event/log shapes that make collaboration
  auditable.
- **Why it matters:** Multi-agent value in Knolo is least-authority
  composition, not free-form agent swarms. Patterns should stay pack-constrained
  and replayable.
- **Rough acceptance criteria:**
  - One documented pattern for nested handoff with return contract verification.
  - One documented ClaimGraph collaboration pattern (propose → approve → commit)
    using injected storage only.
  - Fixtures and tests prove authority escalation is rejected and commits never
    occur without policy or human approval.

#### Live integration demos with real `@knolo/core` Cortex + ClaimGraph

- **What:** Cortex and ClaimGraph modules are typed adapters. Examples use
  in-process fakes. There is no documented demo wiring a real compatible
  `@knolo/core` peer for Cortex query/context and ClaimGraph read/commit.
- **Why it matters:** The core boundary is a product feature; without a live
  demo, consumers must invent integration themselves.
- **Rough acceptance criteria:**
  - Optional demo or docs path that depends on a published `@knolo/core`
    version range (currently documented as `^3.5.0` for TypeScript).
  - No vendoring of core source, credentials, or storage into this repository.
  - Demo fails closed when core is absent (explicit error, not partial silent
    stubs).
  - **Depends on `@knolo/core` availability and stable capability APIs.**

#### Evaluation / scoring harness aligned with the control plane

- **What:** No first-party eval harness exists. Any scoring should consume
  ordered events, artifact hashes, and recorded state—not opaque chat logs.
- **Why it matters:** Governed agents need inspectable evaluation: did the run
  stay within pack authority, hit step budgets, produce expected terminal
  results, and remain replayable?
- **Rough acceptance criteria:**
  - Deterministic fixtures: fixed graphs, packs, host fakes, expected event
    traces and outcomes.
  - Metrics derived from control-plane artifacts (terminal status, step/cost
    usage, policy denials, suspension reasons)—not free-text LLM scores as the
    primary signal.
  - Unit tests remain network-free; live model scoring, if any, is an optional
    host-provided effect with explicit authorization.

### P2 — Later / optional

#### Performance and edge benchmarks (WASM + local-first)

- **What:** No benchmark suite for graph validation, scheduler steps, pack
  compile, WASM inspect/run, or checkpoint I/O.
- **Why it matters:** Local-first and WASM paths need known cost floors before
  embedding in constrained hosts.
- **Rough direction:** Criterion (or equivalent) benches for hot paths; edge
  cases for large graphs, long event logs, and tight step budgets. Keep
  benchmarks offline and deterministic.

#### Packaging, docs, and API stability toward 1.0

- **What:** Artifacts version independently (`knolo-agent`, `knolo-agent-core`,
  `@knolo/agents`). WASM is workspace-validated, not separately published by
  the release workflow. Public APIs are allowed to evolve before 1.0. Docs
  still describe early-release limitations that must stay accurate as gaps
  close.
- **Why it matters:** Downstream integrators need a clear compatibility matrix,
  dry-run publish discipline, and a known freeze bar.
- **Rough direction:**
  - Keep release checklist and compatibility matrix current
    (`docs/releasing.md`, `docs/compatibility.md`).
  - Explicitly list which surfaces are experimental vs stable-on-path-to-1.0.
  - Resolve whether WASM is a published crate/package or remains an embedder
    adapter only.
  - Sync documented versions with published tags; avoid drift between workspace
    crate versions and user-facing “early 0.x” messaging.

#### Optional conveniences (only if they preserve the model)

- Host SDK helpers for common tool registries and filesystem checkpoint stores
  beyond the current minimal implementations.
- Richer redaction rule packs for production event sinks.
- Conformance suite expansion as portable contracts grow (without bloating the
  TypeScript engine into a second full runtime).

#### ICP agent runtime canister (platform target)

- **What:** Host `knolo-agent-core` + scheduler inside an ICP canister so the
  canister is the Host: packs, checkpoints, events, tools, ic-llm / outcalls,
  and optional calls to knolo-core knowledge canisters.
- **Status (Phase 0–4 landed):** Workspace crate `knolo-agent-icp`, ADR-001,
  constraints matrix, deterministic Candid control plane, pack-gated tools,
  ic-llm suspend/resume, knowledge retrieval principal, timers for
  `auto_continue`, cycles + Knolo budget snapshot (`get_budget`),
  **Phase 3:** `ic-stable-structures` schema v1 (definition, pack meta,
  executions, checkpoints, events, budget, limits, handoffs), controller/run
  auth, DoS limits, multi-agent `accept_handoff` / `forward_handoff`, security
  checklist. **Phase 4:** `scripts/icp/*` (build/deploy/load/init-template),
  `@knolo/agents` `IcpAgentRuntimeClient`, cost guide, expanded dfx example.
  Release Wasm ~1.80 MiB (Phase 3).
- **Optional later:** AgentForge-style registry, factory-per-agent topology,
  HTTPS outcall production transforms, mainnet ops runbooks beyond the
  checklist.
- **Docs:** `docs/architecture/adr-001-icp-agent-runtime.md`,
  `docs/architecture/icp-constraints-matrix.md`,
  `docs/architecture/icp-cost-guide.md`,
  `docs/architecture/icp-security-checklist.md`. Local planning notes in
  `.plans/` (gitignored).

## Explicit non-goals (for now)

Knolo Agents is deliberately **not** trying to become:

- A provider/orchestration framework with implicit tool discovery
  or hidden network access.
- A model provider, vector database, job queue, or application data layer.
- A place that vendors, re-exports, or ships `@knolo/core` storage
  implementations or credentials.
- A non-deterministic “agent swarm” runtime without pack authority, ordered
  events, or inspectable handoffs.
- A silent multi-engine fallback layer (TypeScript ↔ WASM ↔ Rust must remain
  explicit).
- A general-purpose WASM sandbox that grants filesystem, network, or clock
  authority by default.

## Notes

### Dependencies on `@knolo/core`

| Future item | Core dependency |
| --- | --- |
| Live Cortex / ClaimGraph demos | Requires compatible published core APIs and peer install. |
| Deeper native pack graph/definition identity | Prefer core-owned binary store or stable definition ids feeding `PackDeclarationV1` / agent references; agents must not absorb storage. |
| Shared run budgets on pack contracts | May require coordinated pack schema version if core owns pack serialization. |
| Evaluation harness | May optionally score core-backed retrieval/claims evidence; harness itself stays in agents or a separate package. |

### Sequencing constraints

1. **Shared budget contracts** before treating pack-level `max_steps` /
   `max_cost_micros` as authoritative policy (today they are validated and
   dropped on the native path).
2. **TypeScript state-snapshot replay** before marketing TS as fully
   audit-equivalent for portable graphs.
3. **WASM execute/resume** after portable contracts and conformance fixtures are
   the single source of truth (avoid a second graph semantics).
4. **Production examples** after pack/budget contracts stabilize enough that
   examples will not thrash.
5. **1.0 freeze** only after P0 items and compatibility docs match shipped
   behavior.

### Already in good shape (do not re-list as missing)

These are present and should be extended carefully rather than rewritten:

- Graph validation and content hashing for resume/replay compatibility.
- Rust scheduler limits, retries, checkpoints, and fail-closed resume hash
  checks.
- Pack compile → policy for tools/namespaces/capability bindings.
- Replay modes (`verify_only`, `mocked_effects`, `live_effects`) with live
  effects requiring explicit authorization.
- HITL suspension tokens bound to artifact hashes and resume schema.
- Authority-narrowing handoff envelopes.
- Explicit TypeScript/WASM engine selection with no silent fallback.
- Least-authority example packs and the `pack_e2e` allowed/denied/replay path.

When closing a gap, update this file, the README “Current status and
limitations” section, and the relevant `docs/` page in the same change.
