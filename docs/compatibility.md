# Compatibility

Contracts are versioned independently from packages. Version 1 readers reject
unknown major versions and resume/replay require exact artifact hashes. Rust
crates support Rust 1.78+; the TypeScript package supports Node 20+ and optional
`@knolo/core` **`^5.1.0`**. TypeScript and WASM exchange only documented JSON
contracts. The release matrix records each independently versioned artifact and
compatible contract.

Harness receipts (`HarnessRunReceiptV1`) are a **new** versioned family. They
do not silently reinterpret `ExecutionEventV1` or `CheckpointV1`.

## Package names

Do not rename published or workspace artifacts:

| Artifact | Name | Notes |
| --- | --- | --- |
| npm | `@knolo/agents` | Graph APIs plus additive harness |
| crates.io | `knolo-agent-core` | Portable contracts |
| crates.io | `knolo-agent` | Native in-process scheduler |
| workspace | `knolo-agent-wasm` | In-process WASM protocol adapter |
| workspace | `knolo-agent-icp` | ICP canister host; consumed via `icpAgent()` |

## Do-not-delete TypeScript surface (`@knolo/agents`)

These exports stay. Additive harness exports may join them; none of the
following may be removed without a documented shim and migration tests.

| Module | Freeze |
| --- | --- |
| `agent` | `Agent.load`, `run`, `stream`, `resume`, `replay`, `replayDeterministic`, `inspect` |
| `builder` | `stateSchema`, `node`, `terminal`, `transition`, `entry`, `limits`, `defineAgent`, `compile`, `fromPack`, `DefinitionError` |
| `engine` | TypeScript engine; WASM engine + `WasmProtocolAdapter`; engines never silently fall back |
| `contracts` | `GraphDefinitionV1`, `ExecutionEventV1`, `CheckpointV1`, tool / retrieval types |
| `cortex` | `CortexCapability`, `cortexQuery`, `cortexContext` |
| `claims` | `ClaimGraphCapability`, `ClaimProposalV1`, `readClaims`, `commitClaimProposal` |
| `multi-agent` | `AuthorityV1`, `HandoffEnvelopeV1`, `assertNarrowAuthority` |
| `hitl` | `HitlSuspensionV1`, `validateResume` |
| `replay` | `ReplayRequestV1`, `validateReplay`, `ReplayTraceV1`, `recordReplayTrace`, `replayDeterministic` snapshot compare (additive) |
| `icp` | `IcpAgentRuntimeClient` and candid-aligned DTOs (low-level client, **not** harness core) |
| `pack` | `fromPack`, `PackReference` |
| `harness` | `createHarness`, `HarnessSession`, `TaskV1`, `HarnessRunReceiptV1` (additive) |
| `adapters` | `callableAgent`, `httpAgent`, `processAgent`, `toolAwareAgent`, `nativeKnoloAgent`, `icpAgent`, `knoloMcpBridge` (additive; ICP only in `icpAgent`; MCP is a generic tool/resource surface, not a vendor SDK) |
| `context` | `compileContext`, `ContextSelectionReceiptV1`, `staticEvidence`, `knowledgeEvidence` (additive) |
| `skills` | `resolveSkills`, `acquireSkills`, `buildCapabilityPack`, `publishLearnedSkill`, `decodeCapabilityPack`, `normalizeSkillDefinition`, `SkillDefinitionV1`, `SkillSelectionReceiptV1`, `SkillAcquisitionReceiptV1`, `SkillPublishReceiptV1` (additive; Hub acquisition is opt-in, next-run only; Hub publish is explicit) |
| `experience` | `LocalExperience`, `ExperienceRecordV1`, `LessonCandidateV1`, `SkillCandidateV1` (additive; local promotion only, Hub publish disabled) |
| `evaluation` | `scoreRecordedRun`, `scoreHarnessRun`, `evaluateRun`, `compareSuites`, `ACS_WEIGHTS` (additive) |
| `recovery` | `classifyFailure`, `parseRecoveryPolicy`, `RecoveryPolicyV1` (additive; policy failures fail closed) |
| `capabilities` | `CapabilityIndex`, `capabilityMetadataFromPack`, `intersectAuthority` (additive; metadata on existing `.knolo` packs) |
| `registry` | `memoryPackRegistry`, `httpPackRegistry`, `PackRegistryCapabilityV1` (additive; Hub optional) |
| `dependencies` | `parseLockfile`, `computeHarnessDependencyRoot`, `DependencyActivation`, `PackDependencyV1` (additive; no second lockfile) |

`Agent.load` engines remain `"typescript" | "wasm"` only. ICP is not an
in-process engine.

## Freeze classes (1.0 candidate)

These classes describe **removal policy**, not a published `1.0.0` version.
A 1.0 version bump still requires the P0 items in `FUTURE.md`. Until then,
do not delete freeze-class surfaces without a shim and migration tests.

| Class | Surfaces | Policy |
| --- | --- | --- |
| **Frozen** | L3 graph APIs in the table above (`Agent.load`, builder, engines, Cortex/ClaimGraph injection, HITL, replay, pack deny-by-default, `IcpAgentRuntimeClient`) | No removals. Behavior changes need a major version. |
| **Stable on the path to 1.0** | Additive harness: `createHarness`, `HarnessSession`, `TaskV1`, adapters (`callableAgent` … `icpAgent`, `knoloMcpBridge`), `compileContext`, `resolveSkills` / `acquireSkills`, `publishLearnedSkill`, `LocalExperience`, evaluation / recovery / registry / dependency-root APIs | Additive only. Removals need a shim, migration tests, and a changelog entry. |
| **Experimental** | `examples/adapters/` vendor wrappers, OpenClaw plugin hook names, live `KNOLO_VENDOR_SMOKE`, WASM `run`/`resume`/`continue` (portable state/routing/suspension; host node dispatch), ICP host features beyond the current Candid surface | May change without a major version. Pin by example path, not by importing vendor code from `@knolo/agents`. |

Rust `knolo-agent-core` parses the same TaskV1, PackDependencyV1,
HarnessDependencyRootV1, and HarnessRunReceiptV1 JSON as TypeScript. That is
contract parity, not a second harness runtime. Native L3 execution stays in
`knolo-agent`.

See [the migration guide](migration.md).

## Do-not-delete Rust surface

| Crate | Freeze |
| --- | --- |
| `knolo-agent-core` | Graph / state / event / pack / policy / HITL / handoff / checkpoint / replay / tool / retrieval contracts, plus portable harness JSON (`TaskV1`, `HarnessRunReceiptV1`, `HarnessDependencyRootV1`) |
| `knolo-agent` | `runtime::Scheduler`, pack loaders, policy ledger, host injection traits |
| `knolo-agent-wasm` | Versioned JSON protocol adapter |
| `knolo-agent-icp` | Candid host surface (`health`, `inspect`, `load_definition`, `start_execution`, `step`, `resume`, handoff, store ops) |

## Core peer

| Agents version | `@knolo/core` peer |
| --- | --- |
| 0.1.3 and earlier | `^3.5.0` (stale; do not build new harness code against this bound) |
| 0.2+ (this conversion) | `^5.1.0`, optional |

See [the universal harness contract](universal-harness-contract.md) and
[the core boundary](core-boundary.md).
