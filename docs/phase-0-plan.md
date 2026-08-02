# Knolo Agents Phase 0 Research and Implementation Plan

## Status

Phase 0 records the architectural research, concept mapping, and approved execution
boundary for the greenfield Knolo Agents repository. No implementation phase starts
until this plan is explicitly approved.

## Research summary

Modern LangChain and LangGraph demonstrate useful concepts: stateful graphs, nodes
and conditional edges, state reducers, structured model output, tools, checkpointed
execution, interrupts, streaming, subgraphs, routers, and agent handoffs. Knolo
Agents adopts those broad ideas but independently designs the implementation around
Knolo's requirements. It does not copy or port LangChain code.

Knolo Agents deliberately improves the model in the following ways:

- **Explicit execution:** immutable, inspectable graph definitions declare every
  edge, retry, budget, and terminal condition. There is no hidden ReAct loop.
- **Typed state transactions:** nodes receive a validated snapshot and return a
  validated patch plus an explicit control outcome.
- **Hard policy enforcement:** models cannot grant tool or namespace authority.
  Pack-derived policies gate every external effect.
- **Pack-derived configuration:** `.knolo` packs define graphs, state schemas,
  tool policies, namespace bindings, memory, claims, and execution limits.
- **Event-sourced replay:** committed transitions emit canonical events, enabling
  offline effects replay and deterministic verification.
- **Small protocol surfaces:** narrow traits, interfaces, registries, and tagged
  unions replace deep inheritance hierarchies.
- **Bounded stochastic behavior:** model calls are explicit nodes governed by the
  deterministic scheduler and validated contracts.
- **Local-first portability:** host capabilities are isolated so the portable Rust
  core can support native and WASM execution.

### Conceptual references

- [LangGraph Graph API](https://docs.langchain.com/oss/python/langgraph/graph-api)
- [LangGraph persistence](https://docs.langchain.com/oss/python/langgraph/persistence)
- [LangGraph interrupts](https://docs.langchain.com/oss/python/langgraph/interrupts)
- [LangGraph subgraphs](https://docs.langchain.com/oss/python/langgraph/use-subgraphs)
- [LangChain agents](https://docs.langchain.com/oss/python/langchain/agents)
- [LangChain multi-agent systems](https://docs.langchain.com/oss/python/langchain/multi-agent)

The official documentation was unavailable from the initial execution environment.
The plan therefore relies only on these public concepts, not undocumented internals.

## Concept mapping

| LangChain or LangGraph idea | Knolo Agents primitive | Deliberate difference |
| --- | --- | --- |
| `StateGraph` | `AgentGraph` and `GraphDefinitionV1` | Immutable, serializable, hashable graph IR |
| Graph state | `StateSnapshot` | Schema-bound value with revision and provenance |
| Node state update | `StatePatch` | Validated transaction with declared write paths |
| Reducer | `StateReducer` | Named, versioned, deterministic implementation |
| Node or runnable | `NodeExecutor` | Narrow protocol returning `NodeOutcome` |
| Conditional edge | `TransitionV1` and `RouteDecisionV1` | A route must reference a declared edge |
| Command | `NodeOutcome` | Separates patches, routing, events, suspension, and termination |
| Agent loop | Explicit graph cycle and `ExecutionLimitsV1` | Every cycle is visible and bounded |
| Tool | `ToolDefinition` and `ToolHandler` | Pack authority is separate from host implementation |
| Tool call | `ToolCallV1` | Schema, namespace, allowlist, budget, and audit checks are mandatory |
| Tool-calling agent | `LLMNode` to `ToolNode` to `VerifierNode` | No hidden tool loop |
| Retriever tool | `RetrieverNode` | Native Knolo query capability |
| Structured output | `ContractRef<T>` and validator | Boundary validation is mandatory |
| Router | `RouterNode` | Deterministic and model-backed routers share one contract |
| Middleware | Ordered `RuntimeHook` pipeline | Hooks cannot create undeclared authority |
| Callback | `ExecutionEvent` | Canonical protocol for audit, streaming, and replay |
| Checkpointer | `CheckpointStore` | Captures graph hash, pack identity, state, and event cursor |
| Thread | `RunId` and `SessionId` | Execution identity differs from Cortex memory identity |
| Interrupt | `Suspension` and `HumanNode` | Durable suspension has a typed resume contract |
| Subgraph | `SubAgentNode` | Scoped child run with explicit projections |
| Handoff | `HandoffV1` | Validates target, state, authority, and return behavior |
| Streaming | `ExecutionStream<ExecutionEvent>` | One ordered protocol across all engines |
| Memory | `CortexStore` | Pack-governed access and provenance |
| Knowledge graph | `ClaimGraphNode` and `ClaimVerifier` | Claims and evidence are typed execution artifacts |
| Mocked models | `RecordedModel` | Offline recordings plus deterministic verification |
| Runtime context | `ExecutionContext` | Explicit capabilities; no secrets in serialized state |

## Target repository shape

```text
knolo-agents/
├── .github/workflows/ci.yml
├── crates/
│   ├── knolo-agent-core/
│   └── knolo-agent/
├── packages/agents/
├── examples/
│   ├── deterministic-router/
│   ├── native-retrieval/
│   └── governed-tool-agent/
├── docs/
├── scripts/
├── schemas/
├── README.md
├── LICENSE
├── Cargo.toml
├── Cargo.lock
├── package.json
├── pnpm-lock.yaml
├── pnpm-workspace.yaml
├── turbo.json
├── tsconfig.json
├── .gitignore
└── .npmignore
```

The existing Rust pack runtime's real crate name and API must be confirmed before
adding it. The implementation must not fabricate a production dependency or replace
pack integration with a duplicate parser.

## Phase 1: clean monorepo, contracts, and pack boundaries

### Goal

Replace the inherited repository with an intentional Knolo Agents workspace and
establish portable contracts shared by Rust, TypeScript, packs, and hosts.

### Deliverables

- Remove inherited LangChain code, metadata, automation, and branding.
- Create Cargo and pnpm workspaces with Turborepo orchestration and strict tooling.
- Add the production README, Apache-2.0 license, ignore files, and CI.
- Scaffold `knolo-agent-core`, `knolo-agent`, and `@knolo/agents`.
- Define identifier newtypes and versioned contracts including
  `GraphDefinitionV1`, `AgentManifestV1`, `RouteDecisionV1`, `ToolCallV1`,
  `NamespaceBindingV1`, `ToolPolicyV1`, `ExecutionLimitsV1`, state schema,
  Cortex, and ClaimGraph configuration.
- Add canonical JSON Schemas and cross-language compatibility fixtures.
- Document the pack extension and version-negotiation mechanism.

### Acceptance criteria

- No inherited LangChain source or project metadata remains.
- Cargo checks and tests pass across the workspace.
- TypeScript linting, type checking, tests, and builds pass.
- Rust and TypeScript serialize shared fixtures identically.
- Invalid IDs, transitions, versions, and policies fail closed.

### `@knolo/core` integration

Core owns pack loading, identity, knowledge access, and native queries. Agents uses a
narrow adapter around verified public APIs and does not duplicate pack parsing.

### Risks and notes

The actual Knolo package APIs and versions require verification. Checked-in schemas
and fixtures are necessary to prevent cross-language drift.

## Phase 2: Rust executor, typed state, and checkpointing

### Goal

Implement the deterministic Rust control plane with graph validation, transactional
state, bounded execution, events, and durable checkpoints.

### Deliverables

- Compile definitions into an immutable graph and validate reachability, node kinds,
  transitions, schemas, terminal nodes, and bounded cycles.
- Implement `StateSnapshot`, `StatePatch`, revisions, paths, reducers, canonical
  serialization, and hashing.
- Implement `GraphExecutor`, `ExecutionContext`, `NodeExecutor`, `NodeOutcome`,
  ordered events, cancellation, limits, and explicit failure transitions.
- Add `DeterministicNode`, `RouterNode`, `LLMNode`, and `VerifierNode`.
- Add `Checkpoint`, `CheckpointStore`, an in-memory store, and safe resume checks.
- Provide recorded models, deterministic clocks and IDs, graph test builders, and
  golden event logs.

### Acceptance criteria

- Identical deterministic inputs produce identical event logs.
- Nodes cannot write undeclared paths or choose undeclared transitions.
- Invalid model output cannot mutate committed state.
- All execution limits are enforced.
- Checkpoint and resume matches uninterrupted execution.
- Recorded model tests are fully offline.
- WASM-incompatible dependencies remain behind optional boundaries.

### `@knolo/core` integration

Runs begin from a verified pack handle. Pack identity and digest become immutable run
metadata, and state schemas resolve through the Phase 1 adapter.

### Risks and notes

Async portability and consistent JSON number handling require shared conformance
fixtures. Packs may reference only registered, versioned deterministic reducers.

## Phase 3: tool runtime, hard policy, and native retrieval

### Goal

Add governed external effects and a first-class native Knolo retrieval node.

### Deliverables

- Add definitions, handlers, registry, invocation, authorization, results, errors,
  and `ToolNode`.
- Enforce version, pack allowlist, namespace, node scope, argument schema, budgets,
  idempotency, result schema, audit event, and state-write checks in that order.
- Add `RetrieverNode`, a `KnoloRetriever` capability, namespace-bound queries,
  result budgets, filters, and source provenance.
- Add security tests for unknown tools, wrong namespaces, malformed arguments or
  results, exhausted budgets, pack changes, and unauthorized state writes.

### Acceptance criteria

- No tool handler executes before successful authorization.
- Handler registration cannot broaden pack authority.
- Model text cannot override a policy.
- `ToolCallV1`, namespace binding, schemas, and allowlists are hard constraints.
- Retrieval is native rather than disguised as a generic tool.
- Tests use offline adapters and preserve idempotency semantics.

### `@knolo/core` integration

Retrieval delegates to Knolo's native query API and preserves core provenance and
source identity. The pack runtime remains authoritative for namespaces.

### Risks and notes

Runtime configuration may restrict but never broaden pack authority. Secrets remain
in host bindings and never enter packs, state, checkpoints, or events.

## Phase 4: TypeScript SDK and dual execution paths

### Goal

Deliver an explicit, ergonomic `@knolo/agents` SDK with streaming, pure TypeScript
execution, and a Rust-powered path.

### Deliverables

- Add builders such as `defineAgent`, `graph`, `stateSchema`, `node`, `transition`,
  `entry`, `terminal`, `limits`, `fromPack`, and `compile`.
- Add `Agent.load`, `run`, `stream`, `resume`, `replay`, and `inspect`.
- Implement the supported core semantics in a pure TypeScript engine.
- Add WASM and optional native adapters using one command/event protocol.
- Require explicit engine selection and never silently degrade semantics.
- Provide inferred state generics, exhaustive unions, `AsyncIterable` streaming,
  `AbortSignal`, typed resume input, and offline test utilities.

### Acceptance criteria

- Developers can install and import `@knolo/agents`.
- Pack-backed builder output compiles in Rust.
- TypeScript and Rust pass shared conformance fixtures.
- Event ordering, cancellation, resource limits, and export maps work.
- Invalid definitions fail before execution.
- Publish dry-runs contain only intentional files.

### `@knolo/core` integration

`Agent.load` accepts a core pack handle. Core owns knowledge and pack capabilities;
Agents owns orchestration. The dependency direction remains one-way.

### Risks and notes

Cross-engine semantic drift is controlled by conformance tests. Browser, Node.js,
and edge WASM entry points remain separate rather than using opaque heuristics.

## Phase 5: Cortex, ClaimGraph, handoffs, HITL, and replay

### Goal

Add governed memory and claims, scoped multi-agent composition, durable human input,
and complete replay semantics.

### Deliverables

- Add `CortexStore`, explicit read/write nodes, scopes, permissions, retention, and
  provenance rules.
- Add `ClaimGraphNode`, claims, evidence, assessments, verifier, confidence, and
  conflict policies.
- Add `SubAgentNode` and `HandoffV1` with child identity, input/output projection,
  capability narrowing, depth limits, and explicit return behavior.
- Add `HumanNode`, durable suspension, resume tokens, schemas, approval outcomes,
  expiration, and policy metadata.
- Add effects replay, deterministic verification, replay forks, integrity chaining,
  divergence reporting, lineage, and redaction.

### Acceptance criteria

- Cortex and ClaimGraph operations honor pack scopes and preserve evidence.
- Child agents cannot gain authority or receive undeclared state.
- Human suspension survives restart and validates resume input.
- Effects replay performs no external calls.
- Verification identifies deterministic divergence.
- Forked runs preserve lineage and all configured limits.

### `@knolo/core` integration

Use actual Cortex and ClaimGraph capabilities from core/runtime. Missing required
capabilities cause a versioned error rather than silent degradation.

### Risks and notes

Memory privacy, redaction, event evolution, and handoff authority require fail-closed
validation and normalized persisted errors.

## Phase 6: CLI, examples, evaluation, WASM, docs, and cleanup

### Goal

Make the repository ready for external developers and complete the clean-room audit.

### Deliverables

- Add minimal validate, inspect, run, replay, schema, and doctor CLI helpers.
- Add at least three CI-tested examples: a deterministic router, native retrieval
  with ClaimGraph, and a governed tool agent with human approval. Add a scoped
  multi-agent handoff example if it improves rather than duplicates coverage.
- Add table-driven evaluation, recorded effects, cross-engine conformance, property
  tests for invariants, and security regression coverage.
- Complete architecture, philosophy, pack contract, security, replay, TypeScript,
  Rust, WASM, and conceptual migration documentation.
- Polish portable WASM entry points, size reporting, and smoke tests.
- Remove temporary plans, placeholders, dead code, unused dependencies, build
  artifacts, stale examples, and inherited project files.
- Audit npm and Cargo package contents, ignore rules, licenses, names, and README
  examples from a clean checkout.

### Acceptance criteria

- A fresh clone installs, builds, tests, validates a pack agent, and runs offline
  examples with the documented commands.
- Tool and namespace policies, retrieval, Cortex, ClaimGraph, suspension, resume,
  replay, and WASM smoke tests pass.
- Formatting, linting, type checking, package audits, and CI pass.
- No secrets, local paths, generated junk, or inherited LangChain metadata remains.
- The working tree is clean after all final checks.

### `@knolo/core` integration

Document and test the compatibility matrix for Agents, Core, the Rust pack runtime,
and pack contracts. Examples use real public APIs except clearly marked offline test
adapters.

### Risks and notes

Examples must run in CI to avoid drift. WASM dependencies require size auditing.
Migration guidance is conceptual only and must never imply a code fork.

## Cross-cutting decisions

### Versioning

All pack-facing and persisted structures carry explicit versions. Unsupported major
versions fail closed; supported additive changes are documented and tested.

### Error model

Errors are typed as definition, compatibility, policy, contract, state, resource,
provider, checkpoint, replay, or suspension failures. Persisted errors use normalized
data rather than language-specific exceptions.

### Capabilities

External work enters through explicit `ModelProvider`, `ToolRegistry`,
`KnoloRetriever`, `CortexStore`, `ClaimGraphStore`, `CheckpointStore`, `Clock`, and
`IdGenerator` capabilities. Graphs contain no live services or credentials.

### Determinism boundary

Pure validation, routing, projection, reduction, and traversal can be re-executed.
Model calls and external effects are recorded. Strict replay consumes recordings;
fork replay requires new authorization for effects.

### No hidden fallback

Unavailable engines, capabilities, contracts, or policies produce actionable errors.
The runtime never silently switches engines, skips validation, or weakens policy.

### Public API stability

Experimental APIs are labeled before stabilization. Published contracts evolve
additively where possible and use versioned replacements when compatibility cannot
be preserved.

## Approval gate

Phase 0 is complete when this plan is saved and reviewed. Full implementation starts
with Phase 1 only after explicit approval to proceed.
