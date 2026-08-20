# Knolo Agents vNext migration plan

This plan describes how Knolo Agents can absorb the useful capabilities of the
`knolo-product` agent harness and become a product for coding agents, AI
employees, and user-defined agents without abandoning the current package
boundaries.

The target is not a Grok-branded fork. The target is a Knolo runtime and
product in which a coding agent is one profile of a general, governed agent.
Knolo product is treated as an implementation reference and an extraction source;
its capabilities must be translated into Knolo contracts, policy, events, and
host adapters before they become part of the product.

## Plan index

The canonical architecture and implementation plan for replacing the imported
harness with a Knolo v4 autonomous agent is
[Knolo v4 Autonomous Agent Integration Plan](knolo-v4-grok-integration-plan.md).
The phase documents below provide the earlier work breakdown and remain useful
as supporting implementation notes; the v4 plan is authoritative where they
overlap.

1. [Phase 1 — Baseline, provenance, and product definition](phase-01-baseline-and-provenance.md)
2. [Phase 2 — Runtime extraction and capability boundaries](phase-02-runtime-extraction.md)
3. [Phase 3 — General agent identity, roles, and memory](phase-03-general-agent-model.md)
4. [Phase 4 — Workspace, tools, and computer-use integration](phase-04-workspace-and-tools.md)
5. [Phase 5 — Delegation, workflows, and multi-agent operations](phase-05-orchestration-and-delegation.md)
6. [Phase 6 — Durability, governance, and evaluation](phase-06-durability-governance-evaluation.md)
7. [Phase 7 — Product surfaces and extensibility](phase-07-product-surfaces-and-extensibility.md)
8. [Phase 8 — Release, migration, and Knolo-owned productization](phase-08-release-and-productization.md)

## Outcome

## First-pass status (2026-08-20)

The initial implementation pass has started in the authoritative parent
workspace while keeping knolo-product as an isolated Grok-derived source tree.

Completed in this pass:

- Phase 1 baseline: Knolo-owned product vocabulary, provenance boundary,
  package ownership, installer plan, and migration gates are documented.
- Phase 2 initial vertical slice: the native CLI has profiles, bounded
  plan/act/observe/terminate execution, approvals, cancellation, retries,
  sessions, a local workspace host, and a provider-neutral model adapter.
- Local-model path: Ollama, LM Studio, llama.cpp, vLLM, and compatible
  OpenAI-style endpoints can be configured without storing credentials.
- Installation diagnostics: knolo doctor checks the local data directories and
  probes a configured model endpoint before a run.
- Phase 3 initial contracts: profiles now include lifecycle/style/success
  metadata and validated memory scopes; memory references and operations carry
  namespace, sensitivity, retention, and provenance; the local adapter recalls
  only from granted read scopes and rejects ungranted writes.
- Phase 4 initial boundaries: provider metadata is validated through one
  registry, and local filesystem/process effects are behind a reusable
  WorkspaceHost boundary.
- Phase 5 initial controls: sessions now distinguish pause from stop, support
  resume, replay, and export commands, and persist a structured run summary
  covering changed resources, verification commands, memory use, and unresolved
  issues.
- Remaining-foundation pass: task actions now normalize to stable ToolCallV1
  candidates, sessions persist versioned task events and checkpoints, resume
  continues from prior observations, and delegation requests carry parent/child
  accountability with narrowed-authority validation.

Still intentionally incomplete after this pass:

- Knolo Core/Cortex/ClaimGraph adapters and authoritative scoped durable memory;
- full ToolCallV1 policy compilation and host registry execution for every task action;
- live checkpoint/event persistence with replay after process restart (the
  current session JSON path is the compatibility baseline);
- executable parent/child orchestration, budget accounting, and workflow scheduling;
- TUI and TypeScript event clients over the same session protocol;
- full Grok capability extraction, sandbox, TUI, MCP/ACP, skills, and plugins;
- real local-model coding verification against Ollama;
- release artifact signing, remote installer publication, and legal review.

The vNext product should let a person choose or create an agent profile with:

- a mission, role, working style, and success criteria;
- explicit tools, data sources, memory, and authority;
- a durable run model with pause, resume, approval, delegation, and audit;
- a host such as local desktop, server, browser, ICP, or another application;
- a user-facing surface such as TUI, CLI, TypeScript, API, or ACP;
- a reusable definition that is portable and reviewable.

The coding agent remains a first-class profile with workspace, shell, file,
search, VCS, review, and test capabilities. An AI employee is the same control
plane with a different profile and pack: for example, a support employee may
have ticket and knowledge tools but no shell, while a research employee may
have web and document tools but no repository write access.

## Required end state: an installable Knolo product

By the end of Phase 8, this is no longer only a Rust runtime or an integration
branch. It must be usable by a new person from a clean machine through a
Knolo-owned installation and product flow:

```text
install Knolo → knolo init → choose/create an agent
  → knolo run --agent coding "fix the failing tests"
  → plan → act → observe → verify → report
  → pause, approve, resume, or stop at any point
```

The product contract must include:

- a versioned `knolo` CLI and documented install, update, and uninstall paths;
- interactive terminal use plus headless task execution for scripts and CI;
- `agent list`, `agent create`, `agent inspect`, `agent run`, `agent resume`,
  `agent logs`, and `agent stop` capabilities;
- built-in Coding, Research, Operations, and Custom agent profiles;
- a task loop that plans, calls approved tools, inspects results, retries safe
  failures, verifies outcomes, and terminates with a structured report;
- persistent sessions with checkpoints, resume, event history, and task status;
- model/provider configuration owned by the host or user, never hard-coded into
  portable contracts;
- visible capability and approval previews before a run begins;
- interactive approval, cancellation, and emergency-stop paths;
- a documented extension path for new tools, models, workspaces, and profiles;
- Knolo-owned README, quickstart, CLI help, examples, help content, and release
  notes.

“Autonomous” means the agent can continue through a multi-step task without a
human responding to every turn, within its graph, pack, budgets, timeouts,
approvals, and stop controls. It does not mean unbounded access or a hidden
policy bypass. A successful release must prove this behavior with a realistic
local coding task and at least one non-coding task.

## Product/documentation migration rule

The user-facing product name, executable name, package descriptions, CLI help,
README files, examples, screenshots, default configuration paths, telemetry
labels, and release messaging must become Knolo-owned. Knolo product references
that describe the imported harness must be removed or rewritten as Knolo
documentation before Phase 8 completion.

This does not mean deleting legal history. Required Apache-2.0 notices,
copyright statements, third-party licenses, source provenance, and attribution
files remain in the repository and release bundle. They move into a clear
`THIRD-PARTY-NOTICES`/provenance area and are not presented as the product
README.

## Package invariants

The migration preserves the current published and workspace packages:

| Package | vNext responsibility |
| --- | --- |
| `knolo-agent-core` | Stable, portable contracts: agent profiles, graphs, state, events, policy, packs, memory references, handoffs, HITL, replay, and evaluation records. |
| `knolo-agent` | Authoritative native runtime, host effect boundary, workspace/tool adapters, durable execution, and orchestration implementation. |
| `knolo-agent-wasm` | Portable protocol adapter for browser and embedded hosts; no hidden provider or filesystem access. |
| `knolo-agent-icp` | Internet Computer control-plane host and stable storage adapter. |
| `@knolo/agents` | Typed builders, profile/pack ergonomics, portable engine, host integration types, and client APIs. |
| `@knolo/core` | Separate peer dependency for Cortex/ClaimGraph and other core data capabilities; never vendored. |

Grok-derived code may initially live in internal modules within these crates or
as private workspace-only targets. A new published package is not created just
to mirror an upstream crate. Any future package split must be justified by an
independent API, release cadence, and security boundary.

## Non-negotiable guardrails

1. **Provenance before code movement.** Record the Grok source revision,
   applicable Apache-2.0 and third-party notices, in-tree ports, and any
   incompatible terms. Preserve notices and mark substantive changes.
2. **Knolo contracts remain authoritative.** Grok behavior is adapted to
   validated graphs, packs, policy checks, state transactions, event ordering,
   checkpoints, and replay. It must not bypass those boundaries.
3. **No provider lock-in in core.** Models, credentials, web services,
   storage, MCP servers, and computer-control backends are host-injected.
4. **Least authority by default.** A profile describes intent; a pack grants
   capability. A prompt never grants authority.
5. **Backward compatibility is explicit.** Existing graph, pack, event,
   checkpoint, WASM, ICP, and TypeScript APIs remain supported or receive a
   documented versioned migration.
6. **Offline tests stay deterministic.** Unit and conformance tests use fixed
   host fakes. Network, model, and real desktop integrations are opt-in.
7. **Product completion is functional, not cosmetic.** Renaming files or
   changing branding is insufficient until installation, interaction, task
   execution, autonomy controls, persistence, and real examples work end to end.

## Version and rollout recommendation

Use a staged `0.2`/`0.3` migration line rather than a flag day:

- `0.2`: introduce profile and capability contracts, with the current coding
  agent behavior preserved behind adapters;
- `0.3`: add durable workspace/tool execution, delegation, and product-facing
  host surfaces while keeping compatibility shims;
- `1.0`: freeze the general-agent contracts after migration tooling, replay,
  policy, and security evidence are complete.

Each phase can land independently. A phase is complete only when its exit
criteria, contract fixtures, tests, documentation, and threat-model updates
are complete.

## Phase sequence

| Phase | Main outcome | Primary package focus |
| --- | --- | --- |
| 1 | Baseline, provenance register, and product definition | Documentation and fixtures |
| 2 | Knolo-native session/runtime seams | `knolo-agent-core`, `knolo-agent` |
| 3 | General profile, role, and memory model | Core contracts, Rust runtime, `@knolo/agents` |
| 4 | Workspace and tool capability adapters | `knolo-agent`, host interfaces |
| 5 | Delegation and workflow execution | Core handoffs, `knolo-agent`, TypeScript helpers |
| 6 | Durable operations, governance, and evaluation | Events, checkpoints, replay, native persistence |
| 7 | CLI/TUI, headless, ACP, and extension surfaces | Composition targets, `@knolo/agents`, adapters |
| 8 | Compatibility release and Knolo-owned product | All packages and release process |

Phases 2–6 are the product core. Phase 7 can be developed in parallel after
the core event and profile contracts stabilize; Phase 8 begins only after the
provenance, security, and compatibility gates are satisfied.

## Cross-phase definition of done

- No Grok-specific type leaks into the public Knolo contracts.
- Every new effect has a capability name, pack grant, budget, event shape, and
  denial test.
- Every durable artifact records the agent, graph, pack, policy, host, and
  implementation hashes needed for replay compatibility.
- The same agent definition can be inspected from TypeScript and Rust.
- A coding profile and a non-coding profile both run through the same control
  plane with different authorities.
- Existing package checks continue to pass, and new behavior has deterministic
  fixtures in `contracts/` or `examples/`.
