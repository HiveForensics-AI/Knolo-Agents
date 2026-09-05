# Universal harness contract

Knolo Agents is an **additive** intelligence and trust harness around a
preserved native graph runtime. A developer does not have to rebuild an
existing agent with Knolo graphs in order to receive Knolo knowledge, skills,
memory, policy, recovery, and evaluation.

This document freezes terminology, assurance levels, lifecycle, authority, and
the ICP adapter boundary for the conversion. Native L3 semantics live in the
existing architecture pages; this page is the harness overlay.

Implementation plan source: `docs/Knolo_Agents_Universal_Harness_Implementation_Plan.docx`.

## Product split

| Product | Owns |
| --- | --- |
| Knolo Core V5 (`@knolo/core` ^5.1.0) | Knowledge Images, retrieval, evidence, roots, authority, Cortex memory, durable run identity |
| Knolo Agents (this repository) | Task contracts, context compilation, skill resolution, tool governance, recovery, evaluation, memory promotion, multi-agent coordination, **and** the in-process L3 graph runtime |
| Knolo Hub | Registry of immutable packs (metadata in Postgres, bytes on Blob) |
| Knolo CLI | `knolo.lock.json`, cache, add / publish / yank |

Core is never vendored here. Hub is never a hosted model runner. Packs are
immutable by digest.

## Package names (unchanged)

| Artifact | Name |
| --- | --- |
| npm | `@knolo/agents` |
| crates.io | `knolo-agent-core`, `knolo-agent` |
| workspace | `knolo-agent-wasm`, `knolo-agent-icp` |

New harness code is added **inside** `@knolo/agents`. Vendor adapters (Grok
Build, Grok, OpenClaw) live under `examples/`. They are not new published package
names.

## North-star API

```ts
const harness = await createHarness({
  agent: callableAgent(existingAgent),
  knowledge: ["./company.knolo"],
  skills: { resolution: "auto", registry: true },
  memory: true,
  evaluation: true,
});

const result = await harness.run({
  objective: "Investigate these transactions for potential fraud.",
  successCriteria: [
    "identify suspicious transactions",
    "cite supporting evidence",
    "do not perform irreversible actions",
  ],
});
```

Everything except the wrapped agent belongs to Knolo: knowledge, memory,
skills, Hub resolution, policy, recovery, and evaluation.

Existing `Agent.load({ engine: "typescript" | "wasm" })` is unchanged. Wrap it
with `nativeKnoloAgent(agent)` when a graph agent should sit behind the
harness. Do **not** add `engine: "icp"` to `Agent.load`.

## Assurance levels

| Level | Integration | What Knolo can add | Typical targets |
| --- | --- | --- | --- |
| L0 Black box | Input → output | Context, knowledge, skills, pre/post evaluation, experience, retry, receipts | Callable functions, closed APIs, simple CLI |
| L1 Tool-aware | Tool / function / MCP | L0 plus tool gating, argument contracts, budgets, alternate tools, tool receipts | Grok Build / Grok function calling, MCP |
| L2 Step-aware | Hooks, checkpoints, turn events | L1 plus pause/resume, HITL, step budgets, recovery, handoffs, richer replay | OpenClaw plugins, custom orchestrators |
| L3 Knolo native | In-process graph / runtime contracts | Full deterministic control plane, native replay, narrowed handoffs, hash-bound checkpoints | `Agent` + `knolo-agent` + optional `engine: "wasm"` |

Compatibility guarantee:

- Accepts input and returns output → at least L0.
- Exposes tools → L1.
- Exposes hooks / checkpoints / events → L2.
- Only the **in-process** Knolo graph runtime is required to reach L3.

ICP, HTTP, CLI, and vendor runtimes declare only the level their adapter can
honestly support. Unsupported gating fails explicitly.

## ICP is an adapter, not harness core

`createHarness`, `HarnessSession`, context compilation, skills, evaluation, and
recovery have **no** ICP types, no Candid DTOs, and no `@dfinity/*` knowledge.

`knolo-agent-icp` remains the canister **host**. TypeScript talks to it only
through `icpAgent()`:

```ts
const harness = await createHarness({
  agent: icpAgent({ actor }),
  knowledge: ["./company.knolo"],
});
```

`IcpAgentRuntimeClient` stays in `packages/agents/src/icp/` as the low-level
client. The harness-facing wrapper lives in `packages/agents/src/adapters/`
and implements `AgentAdapter`.

Import rule: `harness/`, `context/`, `skills/`, `evaluation/`, `recovery/`,
`middleware/`, `core-v5/`, `registry/`, and `dependencies/` must compile if
`icp/` is deleted. The only allowed ICP import into harness-adjacent code is
`adapters/icp.ts` → `icp/`.

A canister may implement L3 semantics on-chain. The harness still sees a
platform adapter (typically L1/L2, depending on which Candid methods exist).
Missing `resume` / checkpoint / handoff methods are limitations on the adapter,
not capabilities of the harness.

## AgentAdapterV1

```ts
export interface AgentAdapter<I = unknown, O = unknown> {
  descriptor(): AgentDescriptorV1;
  capabilities(): AgentCapabilitiesV1;
  invoke(input: I, ctx: HarnessContextV1): Promise<AgentInvocationResultV1<O>>;
  interrupt?(): Promise<void>;
  resume?(checkpoint: HarnessCheckpointV1): Promise<AgentInvocationResultV1<O>>;
  observe?(sink: AgentEventSinkV1): Promise<DisposableV1> | DisposableV1;
}
```

First-party adapters in `@knolo/agents` (same package name):

| Factory | Level | Notes |
| --- | --- | --- |
| `callableAgent()` | L0 | Wrap any async function |
| `httpAgent()` | L0 / L1 | Host-provided `fetch` |
| `processAgent()` | L0 | Explicit argv spawn; never a hidden shell |
| `toolAwareAgent()` | L1 | Tool interception |
| `nativeKnoloAgent()` | L3 | Wrap in-process `Agent` |
| `icpAgent()` | platform | Wrap `IcpAgentRuntimeClient`; host supplies the actor |
| `knoloMcpBridge()` | L1 tools | Generic MCP JSON-RPC surface for `knolo.retrieve` / `knolo.resolve_skills` / `knolo.evaluate`. Vendor Grok Build / Grok / OpenClaw SDKs stay in `examples/adapters/` |

## Runtime lifecycle

1. Normalize the request into `TaskV1` and validate hard constraints.
2. Resolve local pinned packs from `knolo.lock.json` (do not invent a second lockfile).
3. Compile `ContextEnvelopeV1` in priority order: required evidence, constraints, other evidence, skills, memories. Required evidence that does not fit the budget fails closed. Optional semantic rerank is recorded as a non-deterministic external effect.
4. Recall bounded Cortex experience.
5. Resolve local skills. If insufficient **and** registry acquisition is authorized: Hub search → manifest → digest → bytes → Core verify → policy → **stage** for the next run.
6. Freeze the dependency set and compute `HarnessDependencyRootV1`.
7. Intersect authority and compile `ContextEnvelopeV1` within the token / size budget.
8. Invoke the agent through `AgentAdapter`. Intercept tools / events according to the declared level.
9. On failure, run `RecoveryPolicyV1`: bounded retry → alternate strategy → fallback skill → alternate tool → narrowed child → HITL → graceful partial result.
10. Evaluate: deterministic contract / artifact / task checks first; optional host semantic judge second.
11. Persist bounded experience, receipts, events, evaluation, and lesson / skill **candidates**. Promote only through policy / evaluation approval.

**Freeze point:** after `HarnessDependencyRootV1` is computed, newly discovered
Hub versions may be staged for a subsequent run only. No pack hot-swap mid-run.

`HarnessDependencyRootV1` is:

```text
H("knolo.harness.dependencies.v1" || 0x00 || canonicalCBOR(sorted([{ name, version, sha256, stateRoot, role }])))
role = knowledge | skill | policy | evaluation | workflow
```

Canonical CBOR matches `@knolo/core` when Core is present. The frozen root is
bound to `HarnessRunReceiptV1.harnessDependencyRoot`. `registry.pull` after
freeze stages the pack; it cannot join the active set until the next run.

## Authority intersection

```text
Effective Authority =
  Parent Run Authority
  ∩ Agent Authority
  ∩ Skill Requirements
  ∩ Host Capabilities
  ∩ Current Policy
```

A downloaded skill can **request** a capability; it can never **grant** one.
Missing grants deny by default. Handoffs continue to narrow; a child cannot
regain capabilities the parent envelope removed.

## Skills and packs

Skills, policies, evaluations, workflows, and agent profiles are metadata
carried by the existing `.knolo` artifact. They are not a new binary format
and not a second Hub registry.

Local resolution (no Hub):

- `SkillDefinitionV1` is indexed by `CapabilityIndex` from pack JSON metadata.
- `resolveSkills` is lexical and deterministic. Same task + index + authority
  yields the same `SkillSelectionReceiptV1`.
- A skill may **request** `requiredCapabilities` / `requiredTools`. Effective
  authority must already grant them. Missing grants deny the skill; they never
  grant it.
- Explicit `task.preferredSkills` pins fail closed if the skill is missing or
  unauthorized.
- Trust defaults to `registry: disabled`. Automatic Hub acquisition is opt-in
  (`discover` | `acquire-approved` | `acquire-any-verified`), always
  **next-run** staging, and never grants authority. `disabled` never
  downloads. `acquire-approved` requires a pack allowlist. Publish stays
  `propose-only` by default.
- `PackRegistryCapabilityV1` is the optional supply-chain surface:
  `search` / `resolve` / `pull`, plus optional `publish` / `yank`.
- Host HTTP adapter: Hub manifest GET, then **direct Blob GET**. Never shell
  out to `@knolo/cli`. Never forward registry tokens to Blob.
- Read existing `knolo.lock.json`. Mixed registries fail closed without
  explicit `force`. Offline mode is pinned cache only. Yanked versions
  return 410 and fail closed unless forced.

Automatic skill acquisition is opt-in, policy-gated, and cannot grant new
authority. Public publish defaults to `propose-only`.

Local learning (`memory: true`) records bounded `ExperienceRecordV1` rows,
derives `LessonCandidateV1` from repeated useful runs, and may promote a
`SkillCandidateV1` into the local capability index after usefulness,
evaluation, provenance, and approval gates. Promoted skills are available on
the **next** run. Automatic Hub publish stays disabled. Explicit
`publishLearnedSkill` (authorized + approval + passing evaluation) may build a
Core V5 capability pack and publish it to a fixture or Hub registry. Secrets
never enter pack bytes.

## Determinism

LLM inference, external tools, and optional semantic rerank are **external
effects**. They are recorded; they are not labeled deterministic.

Deterministic receipts cover: pack selection, skill selection, policy
decisions, dependency roots, and the recorded inputs / outputs of external
effects.

## Evaluation (ACS)

Relative uplift is measured on a disclosed Agent Capability Score, not a
blanket “smarter” percentage.

| Metric | Weight |
| --- | --- |
| Task success | 30% |
| Grounding / evidence quality | 20% |
| Tool correctness | 15% |
| Recovery / resilience | 15% |
| Constraint / policy compliance | 10% |
| Efficiency | 10% |

Launch target: at least **+10%** composite uplift versus the same raw agent on
the recorded baseline suites, with cost / latency disclosed. See
`contracts/fixtures/harness/acs/`. Live harness runs are scored with
`scoreHarnessRun` / `compareSuites`. Deterministic evaluation order is
contract → artifact → task, then an optional host semantic judge recorded as
a non-deterministic external effect. Recovery classifies
`tool | retrieval | schema | timeout | policy | model | unknown` and applies
bounded retry → graceful partial. Policy denials fail closed and are not
retried.

## Do not delete

These public surfaces stay. Deprecations require shims and migration tests.

- `Agent.load`, `run`, `stream`, `resume`, `replay`, `replayDeterministic`, `inspect`
- Graph builder: `defineAgent`, `stateSchema`, `node`, `terminal`, `transition`, `entry`, `compile`, `fromPack`
- Explicit `engine: "typescript" | "wasm"` with no silent fallback
- `CortexCapability`, `ClaimGraphCapability`
- HITL `validateResume`, replay `validateReplay`, `assertNarrowAuthority`
- Pack / policy deny-by-default behavior
- `IcpAgentRuntimeClient` (low-level client; not harness core)
- Rust `knolo-agent` scheduler and `knolo-agent-core` contracts

Harness events and receipts are versioned separately (`HarnessRunReceiptV1`).
Do not reinterpret existing `ExecutionEventV1` / `CheckpointV1` semantics.

## Related pages

- [Architecture](architecture/README.md) — in-process L3 runtime
- [Core boundary](core-boundary.md) — `@knolo/core` V5 adapters
- [Compatibility](compatibility.md) — freeze matrix
- [Migration](migration.md) — wrap existing agents without a rewrite
- [Security](security.md) — harness checklist
- [ICP ADR](architecture/adr-001-icp-agent-runtime.md) — canister **host**, consumed via `icpAgent()`
