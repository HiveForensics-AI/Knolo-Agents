# Phase 2 — Runtime extraction and capability boundaries

## Objective

Bring the useful Grok execution primitives into the Knolo runtime without
letting provider, UI, filesystem, or process assumptions leak into portable
contracts. The result is a Knolo-native execution kernel that can run coding
and non-coding agents through the same scheduler.

## Design

Keep `knolo-agent-core` small and portable. Add only versioned data contracts
needed to describe agent identity, session intent, model requests, tool
invocations, approvals, memory operations, and lifecycle events. Keep actual
model calls, process spawning, filesystem access, and storage behind host
traits in `knolo-agent`.

The extraction order should be:

1. session and run lifecycle state;
2. model turn/request abstraction;
3. tool protocol and result normalization;
4. cancellation, retry, timeout, and budget handling;
5. transcript compaction and context assembly;
6. event emission and checkpoint integration.

The resulting runtime must include a complete autonomous task loop, not only a
single model-turn adapter:

```text
task intake → plan → authorized action → observe result → update state
           → verify/repair → continue, suspend for approval, or terminate
```

The loop owns lifecycle, state, policy, budgets, cancellation, and events. The
host owns model calls and effects. A task may run for multiple turns and tool
calls, but every continuation is bounded by compiled limits and can be stopped
by the user or host.

## Likely source mapping

| Grok capability family | Knolo landing zone |
| --- | --- |
| `xai-grok-agent`, `xai-agent-lifecycle`, `xai-chat-state` | `knolo-agent-core` contracts plus `knolo-agent` session runtime |
| `xai-grok-models`, sampling, token estimation, compaction | Host-injected model/session traits in `knolo-agent`; portable request/result DTOs in core |
| `xai-tool-types`, `xai-tool-protocol`, `xai-tool-runtime` | Versioned tool contracts in core and policy-checked host execution in `knolo-agent` |
| `xai-grok-shell`, shell base, prompt queue | Native scheduler/session orchestration in `knolo-agent` |
| `xai-grok-session-events`, search, memory | Knolo events, checkpoints, replay, and memory reference contracts |

These are capability mappings, not instructions to copy crate names or
dependencies. Adapt types to Knolo naming and serialization conventions.

## Deliverables

- `AgentProfileV1`, `RunRequestV1`, `ModelRequestV1`, and normalized turn/result
  contracts, if confirmed by Phase 1;
- host traits for model, tool execution, process execution, clock, persistence,
  and cancellation;
- lifecycle events for run start, model turn, tool call/result, compaction,
  suspension, resume, failure, and termination;
- deterministic fake host and conformance fixtures;
- a native coding-agent adapter that preserves current graph/pack behavior;
- a multi-step autonomous task runner with structured terminal reports;
- compatibility notes for existing `Agent`, checkpoint, and replay APIs.

## Package impact

- `knolo-agent-core`: contracts and validation only;
- `knolo-agent`: runtime adapters and execution implementation;
- `@knolo/agents`: typed request/profile builders and inspection APIs;
- `knolo-agent-wasm`: inspect and portable lifecycle messages where supported;
- `knolo-agent-icp`: no model implementation; only host-facing DTO support.

## Exit criteria

- A coding-agent run executes through Knolo policy and emits a replayable event
  trace using a deterministic fake model and fake tools.
- A non-coding run can use the same lifecycle contracts without importing
  workspace or shell code.
- A task can execute multiple plan/action/observation cycles, recover from a
  safe tool failure, and terminate with a typed result using only approved
  capabilities.
- Unauthorized tool calls, exceeded budgets, cancellation, and failed effects
  produce typed, deterministic outcomes.
- No public contract imports Grok-specific modules or provider credentials.

## Risks and mitigations

- **Risk:** model/session behavior becomes embedded in the scheduler.
  **Mitigation:** keep model turns as host effects and make the scheduler own
  control-plane state, policy, and events.
- **Risk:** compaction changes replay semantics.
  **Mitigation:** version compaction inputs/results and checkpoint the artifact
  hash used to resume.
- **Risk:** a broad tool trait becomes an authority bypass.
  **Mitigation:** require capability, namespace, argument, and resource-budget
  checks before the host trait is called.
