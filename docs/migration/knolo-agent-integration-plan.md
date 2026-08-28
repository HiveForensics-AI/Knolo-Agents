# Knolo Agent Integration Plan — V5 Compatibility / V4 Migration

> **Plan revision — 2026-08-28.** The public `knolo-core` repository has moved
> beyond the V4-only assumptions used when this document was drafted. The public
> package is now V5, while V4 remains a compatibility and migration path. The
> revised execution order below supersedes the original V4-first sequencing;
> the detailed eight-phase extraction backlog is retained as historical work
> inventory, not as permission to duplicate upstream runtime ownership.

## 1. Decision and target outcome

Knolo will absorb the imported Grok Build harness as an implementation source,
not expose it as a second product. The final product will be a Knolo agent
runtime with the harness's useful interactive, autonomous, workspace, session,
tool, and extensibility capabilities. It will be governed by the agent
contracts in this repository and powered by the canonical knowledge/evidence
primitives in `knolo-core`.

The completion boundary is now explicit:

- `knolo-core` owns Knowledge Images, pack bytes, roots/digests, deterministic
  query planning and receipts, evidence identity, Cortex/ClaimGraph data, and
  the published V5 runtime primitives.
- Knolo Agents owns graph orchestration, profile-to-authority binding, host
  effect adapters, approval workflows, model/provider seams, and product
  surfaces.
- The two repositories integrate through narrow versioned adapters and
  conformance fixtures. Agent code must not recreate or vendor core storage,
  verification, or knowledge-image formats.

The public experience is:

```text
install Knolo
  -> knolo init
  -> knolo agent create --template coding my-agent
  -> knolo run --agent my-agent "complete this task"
  -> plan -> retrieve -> act -> observe -> verify -> report
  -> pause / approve / resume / stop / replay
```

The product is not limited to coding. Coding is one built-in profile. The same
runtime must support research, operations, support, analysis, and user-created
agents by changing the profile, knowledge packs, memory scopes, tools, and
policy—not by creating separate agent implementations.

The imported harness is complete only when its useful behavior is reachable
through `knolo`, its model/provider system is Knolo-owned, its authority flows
through Knolo policy, and no user-facing surface instructs users to run `grok`
or configure an upstream product.

## 2. Knolo V5 alignment and V4 migration

V5 is now the published compatibility line for consumers. V4 remains readable
through explicit migration and compatibility adapters. The agent must use
`knolo-core` as an active knowledge/evidence dependency and bind new work to the
published V5 APIs and fixtures, without creating a parallel artifact store.

| `knolo-core` capability | Agent responsibility |
| --- | --- |
| V5 Knowledge Images and V4 migration | Consume mounted artifacts through an adapter; preserve stable source/evidence identity and fingerprints. Agent authority packs remain separate from knowledge artifacts. |
| Deterministic lexical retrieval, query plans, and receipts | Ground planning and tool selection with reproducible evidence; persist the plan/receipt reference in agent context and events. |
| Optional hybrid reranking | Use only as an explicit host capability over bounded lexical candidates; never replace lexical grounding or evidence identity. |
| `LivePack` / V5 mutable or event overlays | Use core-owned overlay APIs for task/project knowledge; do not create a second agent-owned document store. |
| Cortex | Request scoped memory through a narrow adapter; preserve core-owned memory IDs, namespaces, provenance, retention, and replay data. |
| ClaimGraph | Treat claims as core-owned evidence structures; agent workflows may propose/review/commit, but do not implement a parallel claim database. |
| `RouteDecisionV1` | Validate routing from a task to an agent/profile or specialist. Routing is a decision, not authority. |
| `ToolCallV1` | Normalize every model-requested action before policy validation and host execution. |
| Namespace and policy binding | Combine core knowledge scope with agent pack authority; a successful retrieval must not imply permission to act. |
| Core Rust/TypeScript/CLI/ICP surfaces | Prefer published core APIs and conformance vectors; keep agent host effects restricted to the runtime that owns them. |

The agent runtime must never copy `@knolo/core` into this repository. The
existing core boundary remains authoritative. Rust owns agent execution,
TypeScript owns ergonomic composition, and Knolo Core owns knowledge/memory
artifacts, verification, and its published runtime primitives.

## 3. Target architecture

```text
                         user / application / CI
                                  |
                      knolo CLI, TUI, API, ACP
                                  |
                         Agent Control Plane
       profile + graph + pack bindings + policy + budgets + approvals
                                  |
              Knolo Core Knowledge/Evidence Layer
              V5 mount -> evidence/receipts/context
                    -> validate route/tool decisions
                                  |
                      Autonomous Session Runtime
          intake -> plan -> authorize -> execute -> observe -> verify
             ^              |                    |              |
             |              |                    |              v
       checkpoint/replay    |             workspace/tool host  report
                            v
                    model/provider adapter
             Ollama / OpenAI-compatible / cloud / custom
                                  |
                  Knolo-owned host capability boundary
       filesystem, process, PTY, VCS, MCP, ACP, browser, secrets, sandbox
```

### Control plane

The control plane compiles an agent definition into an inspectable run plan:

- agent identity, role, mission, and success criteria;
- graph/state schema and terminal conditions;
- mounted base packs and namespace bindings;
- LivePack overlays and Cortex memory scopes;
- available model/provider and fallback policy;
- allowed tools, effect risk, approvals, budgets, timeouts, and concurrency;
- host requirements and persistence mode.

The compiled plan is hashed and recorded in run events and checkpoints.

### Autonomous runtime

The imported harness's session loop, context assembly, compaction, retry,
cancellation, progress reporting, and interactive behavior are adapted behind
the Knolo runtime. The runtime, not the model, owns state transitions, limits,
policy checks, effect receipts, suspension, and final status.

### Knowledge and memory

There are three deliberately separate stores:

1. **Base Pack** — immutable, versioned role/domain knowledge and policy
   material built with Knolo Core.
2. **LivePack** — mutable project/task documents and overlay facts keyed by
   stable IDs; every update is evented and serializable.
3. **Cortex** — append-only agent memory with labels, namespaces, provenance,
   confidence, importance, retention, and forget/consolidation operations.

ClaimGraph proposals can be produced from memories or tool results, but a
claim is not treated as durable truth until the configured approval/commit
workflow accepts it.

### Effect boundary

Every model-proposed action becomes a `ToolCallV1` candidate. The runtime then
checks profile, pack, namespace, capability, arguments, resource budget,
approval policy, and host availability. Only the host can execute the effect.

## 4. Package ownership and preserved boundaries

No current package is removed, renamed, vendored, or silently replaced.

| Package | Final responsibility |
| --- | --- |
| `knolo-agent-core` | Stable Rust contracts: profiles, graphs, runs, model turns, context references, route/tool decisions, policies, events, state, handoffs, memory references, checkpoints, replay, and evaluation artifacts. |
| `knolo-agent` | Native autonomous runtime, model adapters, context assembly, session loop, effect authorization, local workspace/tool hosts, persistence, CLI, and TUI composition. |
| `knolo-agent-wasm` | Portable inspection, routing, validation, and host-driven execution protocol; never hidden filesystem/process/provider access. |
| `knolo-agent-icp` | Bounded ICP control-plane/storage adapter for packs, run metadata, claims, and supported event workflows; no unrestricted OS effects. |
| `@knolo/agents` | Typed profile/pack/model/run builders, host interfaces, event clients, template loading, and application embedding. |
| `@knolo/core` | External Knolo dependency for published V5 Knowledge Images, verification, receipts, Cortex, ClaimGraph, and V4 migration APIs. It is not copied into this repo. |
| `knolo-agent-system/` | Full Knolo Agent product workspace containing the adapted Grok-derived system. It owns product composition, not the portable authority model; it remains an independent workspace with explicit adapter integration. |

The historical harness Cargo workspace may remain isolated during extraction to
keep builds manageable. Its crates are not public API. Once a capability has a
Knolo-native implementation and conformance coverage, the corresponding source
can be retired from the product build while its required notices and provenance
remain archived.

## 5. Harness capability mapping

The migration is capability-by-capability. Do not merge the upstream crate
graph wholesale.

| Imported capability | Knolo v4 destination | Completion condition |
| --- | --- | --- |
| TUI/pager/session UI | `knolo-agent` product surface | Shows Knolo agent/profile, pack, authority, retrieved context, actions, approvals, and run events; no upstream branding or commands. |
| Conversation state and compaction | Core session/context contracts plus native runtime | Compaction is versioned, checkpointed, redacted, and replay-compatible. |
| Model turns and streaming | Provider-neutral `ModelRequestV1`/result contracts and host adapters | Ollama works first; OpenAI-compatible and custom providers use the same interface; credentials never enter packs or events. |
| Workspace discovery and codebase inspection | Workspace host capability | Read-only inspection works for coding agents and is unavailable to non-coding profiles unless granted. |
| File edits, patches, VCS, worktrees | Capability-scoped tools | Each action is normalized, previewed, approved as configured, and recorded with an effect receipt. |
| Shell, process, PTY, computer use | Separate high-risk host capabilities | No shell or desktop authority is implied by being an agent; sandbox and approval policy are host-enforced. |
| Search and code navigation | Workspace tools plus Knolo retrieval | Code search and knowledge retrieval remain distinguishable in context and audit events. |
| MCP/ACP | Explicit adapters | Discovery never grants authority; every bound tool maps to `ToolCallV1`, policy, namespace, and run IDs. |
| Plugins/hooks | Declarative, capability-declared extensions | Plugins cannot alter policy, inject secrets, or bypass the effect boundary. |
| Sessions/checkpoints | Knolo events, persistence, replay | Runs pause, resume after restart, and fail closed on incompatible artifacts. |
| Diagnostics/crash handling | Knolo run status and audit APIs | Failures are typed, actionable, resumable where safe, and never silently retried when effects may duplicate. |

## 6. Historical eight-phase extraction backlog

The eight phases below remain useful for tracking selected harness capabilities,
but they are no longer the implementation order. They were written against a
V4-only core boundary and should not be used to justify duplicating V5
Knowledge Image, verification, durable-run, or receipt functionality. The
revised order is in section 11.

### Phase 1 — Baseline, provenance, and v4 contract lock

**Objective:** establish exactly what is being absorbed and freeze the Knolo v4
integration boundary before more code moves.

**Build work:**

- Pin the imported harness source revision and generate a capability inventory.
- Record every adapted component, license, notice, copyright, and substantive
  modification in the release provenance register.
- Inventory the actual Knolo v4 exports used by the agent: pack mount/query,
  LivePack, Cortex, ClaimGraph, `RouteDecisionV1`, `ToolCallV1`, namespace and
  tool-policy validators.
- Freeze compatibility fixtures for current graphs, packs, events, checkpoints,
  WASM messages, ICP DTOs, and `@knolo/agents` types.
- Define the product vocabulary: agent, profile, pack, memory, run, host,
  capability, approval, effect, route, and claim.

**Deliverables:** capability matrix, provenance register, v4 dependency matrix,
threat-model update, baseline schemas, and product acceptance specification.

**Exit gate:** no selected harness capability lacks an owner, no public Knolo
contract references an upstream type, and legal review approves the extraction
map.

### Phase 2 — Knolo-native session kernel

**Objective:** place the harness's autonomous loop behind the Knolo control
plane.

**Build work:**

- Add versioned `AgentProfileV1`, `RunRequestV1`, `ModelRequestV1`,
  `ModelResultV1`, `ContextItemV1`, `ToolCallV1`, `ToolResultV1`, and lifecycle
  event contracts where absent.
- Implement the scheduler: intake, plan, route, authorize, execute, observe,
  verify, suspend, resume, fail, and terminate.
- Add cancellation, retry classes, deadlines, token/cost budgets, turn limits,
  concurrency limits, and emergency stop.
- Adapt transcript compaction and streaming without allowing them to mutate
  policy or durable state outside typed transactions.
- Build deterministic fake model, fake host, and fake clock conformance tests.

**Exit gate:** a fake-model coding task and fake-model non-coding task both run
through multiple turns, produce typed events, recover from a safe failure, and
reject unauthorized effects.

### Phase 3 — v4 context, memory, and agent identity

**Objective:** make Knolo knowledge and memory first-class inputs to every
agent run.

**Build work:**

- Define profile templates for Coding, Research, Operations, Support, and
  Custom agents.
- Mount immutable `.knolo` packs during compilation and bind allowed
  namespaces explicitly.
- Add deterministic lexical retrieval as the default context path. Preserve
  source, namespace, stable ID, score, and pack fingerprint in context events.
- Add optional hybrid reranking as a host feature over lexical top-N only.
- Add Cortex recall/write/forget/consolidation operations with scope,
  sensitivity, retention, and provenance checks.
- Add ClaimGraph proposal context and `propose -> review -> commit` flows.
- Keep instructions, retrieved documents, memories, model output, and tool
  results as separate typed context classes.

**Exit gate:** the same graph runs as a coding agent and research agent with
different packs, memories, namespaces, and authority; cross-namespace reads
and ungranted memory writes fail deterministically.

### Phase 4 — Model/provider and workspace integration

**Objective:** replace upstream model/config assumptions and bring the harness
work capabilities into Knolo's host boundary.

**Build work:**

- Implement one provider registry used by CLI, TUI, TypeScript, and headless
  execution.
- Support Ollama as the first-class local provider using OpenAI-compatible
  HTTP, followed by LM Studio, llama.cpp/vLLM, OpenAI-compatible cloud hosts,
  and custom adapters.
- Separate chat/generation models from embedding models; never use an
  embedding-only model for agent turns.
- Move model credentials and endpoints to host configuration; never store them
  in packs, profiles, checkpoints, or logs.
- Port workspace discovery, file read/write, patch, search, VCS, worktree,
  process, PTY, and optional browser/computer capabilities as separate tools.
- Add preview/diff mode, idempotency keys, effect receipts, redaction, and
  approval policies for side effects.
- Add MCP and ACP adapters only after their discovered tools map cleanly to
  Knolo contracts.

**Exit gate:** `knolo` can run a real local Ollama coding task with read-only
inspection, an approved edit, tests, and a final report; a research profile has
no shell/filesystem tools in its compiled authority preview.

### Phase 5 — Full autonomous harness experience

**Objective:** make the imported agent behavior feel complete through Knolo,
including interactive sessions and long-running work.

**Build work:**

- Adapt the pager/TUI as a Knolo renderer over the same run/event protocol as
  headless CLI execution.
- Add interactive agent selection, task intake, context/authority preview,
  streaming progress, approval prompts, denial explanation, and live timeline.
- Add run controls: pause, resume, cancel, stop, retry-safe failure, inspect,
  logs, replay, and export.
- Add autonomous continuation rules: max steps, idle timeout, run timeout,
  approval checkpoints, retry classes, budget exhaustion, and stop conditions.
- Add structured reports containing goal, actions, retrieved evidence,
  changed resources, tests, unresolved issues, and policy decisions.
- Add skill installation and skill creation as declarative profile/pack/tool
  bundles. A skill may add knowledge, prompts, routing hints, or declared tools;
  it cannot grant itself authority or execute arbitrary code.

**Exit gate:** a user can leave a multi-step run unattended within configured
limits, reconnect later, approve an action, resume, and receive the same final
result through TUI, CLI headless, and the TypeScript client.

### Phase 6 — Delegation, workflows, and organizational agents

**Objective:** turn one autonomous agent into a governed system for teams of
specialized agents without creating an authority loophole.

**Build work:**

- Use `RouteDecisionV1` for task-to-agent/profile routing.
- Add typed parent/child handoffs with task, return schema, projected context,
  narrowed pack, budget, deadline, correlation IDs, and expiry.
- Add manager -> specialist -> reviewer and planner -> worker -> verifier
  workflow templates.
- Allow research outputs to become ClaimGraph proposals and business workflows
  to update LivePack only through approved operations.
- Add bounded fan-out, depth, concurrency, cancellation propagation, and
  aggregate budget accounting.
- Add scheduled/resumable runs only with explicit host support and durable
  ownership/stop controls.

**Exit gate:** parent/child runs replay with causal event order, cannot escalate
authority, validate return schemas, and survive child denial, timeout, partial
result, and parent cancellation.

### Phase 7 — Product surfaces, skills, and host ecosystem

**Objective:** expose the complete Knolo agent product consistently everywhere.

**Build work:**

- Make `knolo` the only public executable and remove `grok` from user-facing
  help, examples, installer text, config paths, and release artifacts.
- Finish CLI commands for init, models, providers, profiles, packs, skills,
  run, sessions, approvals, logs, replay, stop, and diagnostics.
- Publish a stable headless JSON protocol and map ACP sessions to Knolo run IDs.
- Expand `@knolo/agents` with typed builders, model config, pack bindings,
  LivePack/Cortex integration, route/tool clients, events, and run controls.
- Add host adapters for local desktop/server, remote workspace, WASM, and ICP
  with explicit capability matrices.
- Add skill/package manifests with version, inputs, pack fingerprints, required
  capabilities, provenance, and upgrade/rollback behavior.
- Provide examples for coding, research, support, operations, and a custom
  employee agent using the same runtime.

**Exit gate:** one agent definition is inspectable and runnable from CLI, TUI,
headless JSON, and TypeScript; every surface displays the same authority,
retrieval, memory, status, and approval information.

### Phase 8 — Migration, hardening, and Knolo v4 release

**Objective:** ship a clean, installable Knolo product and retire the imported
harness as a public identity.

**Build work:**

- Create release binaries/installers for the supported host matrix and test
  install, update, uninstall, and rollback on clean machines.
- Rewrite the main README, CLI help, examples, troubleshooting, and release
  notes as Knolo documentation.
- Move imported implementation notes into contributor/provenance documentation
  and retain required Apache-2.0/third-party notices in the release bundle.
- Add stale-branding scans for `grok`, upstream URLs, upstream config keys,
  upstream telemetry, and unsupported login/install instructions.
- Complete security review for process, filesystem, secrets, MCP, ACP, browser,
  plugins, memory, claims, and delegation.
- Publish migration tooling for existing profiles, packs, sessions, and
  checkpoints with explicit schema/version reports.
- Freeze v1 agent contracts only after replay and upgrade compatibility are
  demonstrated.

**Exit gate:** a new user installs Knolo, configures Ollama or another provider,
creates a coding and non-coding agent, runs a real multi-step task, exercises
deny/approve/pause/resume/stop, inspects audit/replay, and upgrades without
losing documented data. No public flow requires the imported harness name.

## 7. Required contract set

The following contracts are release-blocking. Names may evolve before v1, but
the semantics must remain explicit and versioned.

### Agent and profile

```text
AgentProfileV1
  id, display_name, role, mission, success_criteria
  graph_ref, base_pack_refs, namespace_bindings
  cortex_scope, live_pack_scope, claim_policy
  model_ref, host_requirements, capability_policy
  budgets, approvals, retention, version
```

Profiles are declarative and cannot contain credentials or executable code.

### Context and retrieval

```text
ContextItemV1
  kind: instruction | retrieval | memory | claim | tool_result | observation
  source_id, pack_fingerprint, namespace, text_or_reference
  provenance, sensitivity, created_at, expires_at
```

Retrieval must preserve deterministic lexical results and exact pack/overlay
fingerprints. Hybrid reranking is recorded as an additional deterministic or
host-owned step, not as a replacement for the lexical result.

### Tool and effect authorization

```text
ToolCallV1
  type, call_id, tool, args, run_id, requested_by

EffectDecisionV1
  call_id, capability, allowed, reason, approval, policy_hash, budget_delta

EffectReceiptV1
  call_id, host, idempotency_key, status, redacted_output, resource_delta
```

The model can request a tool but cannot authorize it. The host can execute only
after Knolo policy accepts the validated request.

### Run, event, checkpoint, and replay

Every run artifact must bind:

- agent/profile and graph hashes;
- base pack, LivePack, Cortex, and ClaimGraph fingerprints;
- model/provider identity without secrets;
- compiled policy and host capability hashes;
- schema and implementation versions;
- ordered events, approvals, effect receipts, and final report.

Resume must fail closed if the compatibility proof is missing or invalid.

## 8. Test and evaluation program

### Deterministic contract tests

- schema round trips and unknown-field rejection;
- route validation and invalid selected-agent rejection;
- tool allow/deny, namespace escape, argument, budget, and approval tests;
- LivePack add/update/remove/serialize/reload tests;
- Cortex recall, forget, labels, scopes, retention, merge, and replay tests;
- ClaimGraph deterministic extraction, proposal, merge, and commit tests;
- checkpoint compatibility and stale-version rejection;
- event ordering and replay equivalence.

### Model-independent runtime tests

- multi-turn plan/action/observation loop;
- safe failure retry versus non-idempotent effect refusal;
- cancellation, timeout, token budget, cost budget, and concurrency limits;
- pause/approval/resume/stop after restart;
- parent/child delegation and aggregate limits;
- redaction of secrets and sensitive memory/tool output.

### Local model tests

- Ollama generation through the provider registry;
- small-model JSON plan robustness and malformed-output fail-closed behavior;
- chat model versus embedding model validation;
- offline run with no network except the configured local endpoint;
- provider timeout, unavailable model, context overflow, and retry behavior.

### End-to-end acceptance tasks

1. **Coding:** inspect a repository, identify a failing test, edit files,
   execute tests, summarize the diff, and stop when verified.
2. **Research:** retrieve from a `.knolo` pack, recall scoped Cortex memory,
   produce cited findings, and propose ClaimGraph updates without shell access.
3. **Operations:** process a fixture queue through declared tools, require
   approval for an external side effect, persist the result in LivePack, and
   resume after restart.
4. **Custom skill:** install a declarative skill pack, run it with a bounded
   capability set, and prove it cannot access an undeclared namespace/tool.

### Release quality gates

```bash
cargo fmt --all --check
cargo check --workspace
cargo test --workspace
pnpm install --frozen-lockfile
pnpm --filter @knolo/agents check
pnpm --filter @knolo/agents test
```

Additional gates include contract/schema checks, deterministic evaluation,
license/provenance verification, stale-branding scan, clean-machine installer
test, Ollama smoke test, and supported-host security review.

## 9. Migration and rollout strategy

### Compatibility line

- **0.2:** preserve the current agent contracts and ship a V5-compatible core
  adapter for deterministic retrieval/evidence; the imported harness stays
  development-only.
- **0.3:** add V5 evidence/query-plan bridge coverage, durable agent records,
  and one product workflow. V4 migration remains an explicit compatibility
  feature, not the primary dependency.
- **1.0:** freeze the agent control-plane contracts only after the core
  compatibility matrix, replay/receipt semantics, upgrade path, and security
  posture are demonstrated.

### Feature gates

Start with read-only and approval-heavy defaults. Enable write tools, process,
MCP, browser, delegation, schedules, and autonomous continuation separately.
Each gate has a capability preview, test fixture, rollback path, and audit
event.

### Definition of product completion

The project is complete only when all of these are true:

- the imported harness's required autonomous loop is behind Knolo runtime APIs;
- the TUI and headless CLI are two renderers of the same run protocol;
- Ollama and other providers are configured through Knolo;
- `.knolo` packs ground the agent deterministically;
- LivePack, Cortex, and ClaimGraph are integrated with explicit scopes;
- tools, plugins, MCP, ACP, workspace, process, and computer use are policy
  checked and auditable;
- coding, employee, and custom profiles share one runtime;
- skills can be added without granting themselves authority;
- pause, approval, resume, stop, replay, and crash recovery work;
- install, documentation, help, branding, and release artifacts are Knolo-owned;
- required licenses, notices, and provenance remain intact and clearly
  separated from product branding.

## 10. Immediate implementation order

The first implementation sprint after approving this plan should be:

1. Pin the supported published V5 `@knolo/core` line and record the V4
   migration surface and conformance-fixture policy.
2. Add a narrow core adapter for mounted Knowledge Images, deterministic
   retrieval, evidence identity, query plans/receipts, LivePack, Cortex, and
   ClaimGraph. Keep these interfaces out of `knolo-agent-core`'s portable
   contract crate.
3. Add cross-runtime fixtures that prove V5 evidence/receipt fields are
   preserved and that V4 migration remains explicit. Unknown or unavailable
   capabilities must fail explicitly.
4. Refactor `knolo run` so planning context is typed evidence and every model
   action becomes a validated `ToolCallV1` or route decision before host policy.
5. Finish one local vertical slice: research retrieval with citations and a
   coding task with an approved edit, test execution, checkpoint, replay, and
   structured report.
6. Make the native runtime's event/checkpoint model authoritative for agent
   orchestration, while recording core artifact/receipt fingerprints instead of
   reimplementing core durability or verification.
7. Only after that slice passes, resume ICP, standalone WASM, TUI, and imported
   product extraction as separately gated host adapters. Do not publish or
   advertise any of them as complete before their conformance paths are green.

This order makes the framework useful quickly while ensuring that later
capabilities land inside the stable agent boundary and the published core V5
knowledge/verifiability model.

## 11. Revised completion plan after the core V5 change

### Track A — Core compatibility bridge

Deliver the smallest useful integration with the public core line:

- a host-owned `CoreKnowledgeProvider`/equivalent adapter, with V5 as the
  primary capability set and explicit V4 migration reporting;
- mounted artifact identity, namespace scope, deterministic retrieval results,
  evidence spans, query-plan/receipt references, and source fingerprints;
- optional LivePack, Cortex, and ClaimGraph adapters with explicit absence and
  denial behavior;
- versioned fixtures and a compatibility table that separates published V5 APIs
  from the legacy V4 migration surface;
- no dependency from the portable Rust contract crate on a TypeScript package,
  core implementation, or core-owned binary format.

### Track B — Agent control-plane completion

Finish the framework capabilities that remain agent-owned:

- make the native scheduler the single authority for graph transitions,
  approvals, tool policy, budgets, effects, checkpoints, and run events;
- complete state-level deterministic replay, including state snapshots and
  core receipt/evidence references where present;
- ensure every task action is policy-compiled and executed through the same
  `ToolCallV1` path, including the current product CLI path;
- define idempotency and effect-receipt rules for retries, resume, and
  non-deterministic host effects;
- add coding and research acceptance fixtures using the same control plane but
  different authority packs and knowledge scopes.

#### Delivered in the current implementation pass

- TypeScript reports now retain the initial state and every patched revision;
  snapshot-aware replay compares the complete state trace while the original
  event-only replay API remains compatible.
- Native tool definitions now declare retry class, and every native tool
  attempt emits a redacted `EffectReceiptV1` for executed, denied, or failed
  outcomes. The call ID is the explicit idempotency key.
- The full product workspace is wired to the governed boundary through
  `knolo-agent-system/crates/integration/knolo-governed-adapter`; product
  requests are validated `ToolCallV1` candidates before the native host policy
  path.

The product adapter is deliberately a normalization seam, not a second policy
engine. The live product bridge now crosses that seam; the remaining work is
to prove coding and research runs end to end with shared events, approvals,
checkpoints, replay, and reports.

The framework-level coding slice is now available as `runLocalCoding`: it
covers inspection, explicit edit approval, receipt propagation, test
verification, and pre-effect suspension for denied edits. The full product
workspace uses the same governed bridge, but its broader tool catalog and
interactive surfaces remain host-specific.

### Track C — Product thin slice

Port only the harness capabilities needed to prove the product contract:

- local model/provider configuration without credentials in artifacts;
- read-only workspace inspection, approved edits, test execution, pause,
  resume, stop, replay, and headless reporting;
- retrieval-grounded research with citations and a denied shell capability;
- one CLI/headless/TypeScript event and report shape shared across surfaces.

The `knolo-agent-system/` tree is the full product workspace, not a temporary
placeholder or second product. Its independent Cargo workspace and provenance
boundary are intentional. It becomes publishable through a Knolo integration
facade only after product actions route through the governed agent contracts.
Do not make it a root Cargo workspace member or treat its generated `target/`
output as part of the framework release.

### Track D — Deferred host adapters

Resume ICP, standalone WASM, TUI, ACP/MCP, browser/computer use, and broader
multi-agent orchestration only after Tracks A–C are green. Each adapter must
consume the same graph/policy/event contracts and declare which V5 core
capabilities it supports, plus any explicit V4 migration support. ICP remains a host/deployment option, not the
architecture that defines the framework.

### Revised completion gate

The pending version is complete when a clean host can run both a coding and a
research agent through the shared control plane; retrieval is backed by the
published V5 core path; core evidence/receipt identity is preserved; tool
authority, approvals, budgets, checkpoint/resume, and replay are tested; and
the CLI, TypeScript surface, and native runtime report the same run semantics.
V4 migration may remain explicitly gated, but no core-owned artifact or
verification behavior may be silently re-created inside Knolo Agents.
