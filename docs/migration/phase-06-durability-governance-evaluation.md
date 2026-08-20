# Phase 6 — Durability, governance, and evaluation

## Objective

Make long-running agents operationally trustworthy. Sessions must survive
restarts, pauses, approvals, and host changes while remaining inspectable,
replayable, policy-constrained, and measurable.

This phase also turns autonomy into an operational product capability. A user
must be able to start a task, leave it running, return to its progress, approve
or deny a requested action, inspect what happened, resume after interruption,
and stop it immediately.

## Workstreams

### Durable sessions

Unify Grok-style session persistence, checkpoints, transcript compaction, and
Knolo artifact binding. A checkpoint should bind at minimum to the profile,
graph, pack, compiled policy, host contract, implementation, and schema hashes.
Resume must fail closed when compatibility is not proven.

### Governance and approvals

Define approval policies by capability risk, data sensitivity, destination,
agent role, and action scope. Support pre-approval, just-in-time approval,
four-eyes approval, expiration, and emergency cancellation. Record decisions as
events without storing secrets.

### Audit and observability

Expose run timelines, tool calls, denials, budgets, state revisions, handoffs,
memory changes, approvals, and final outcomes. Separate user-facing summaries
from complete audit records and redact each according to policy.

### Evaluation harness

Build a deterministic evaluation runner over contracts and fixtures. Score:

- policy compliance and denial correctness;
- terminal outcome and schema validity;
- step/token/cost/time budgets;
- replay equivalence and checkpoint resumability;
- human approval adherence;
- task-specific quality supplied by a host evaluator.

Do not make opaque model scores the only definition of agent quality.

### Autonomous-operation controls

Add explicit controls for maximum autonomy depth, retry classes, idle timeout,
run timeout, token/cost ceiling, tool concurrency, approval checkpoints, and
emergency stop. Surface these settings in the CLI and interactive session. A
run that reaches a limit must suspend or terminate with a reason rather than
silently continuing.

## Deliverables

- durable session/checkpoint schema extensions;
- approval policy contracts and UI-neutral decision events;
- audit export format with redaction profiles;
- evaluation runner and golden fixtures;
- failure-injection tests for crash, duplicate delivery, stale resume, and
  partial host effects;
- operational runbook for local, server, and ICP hosts;
- autonomy-control matrix and emergency-stop test evidence;
- security review covering Grok-derived adapters and new capabilities.

## Package impact

Core owns versioned artifacts and event contracts. Native persistence, replay,
evaluation execution, and observability adapters belong in `knolo-agent`.
`@knolo/agents` exposes typed inspection and evaluation result readers. ICP
stores stable artifacts; WASM remains host-backed where durable storage is not
available.

## Exit criteria

- A suspended coding run and a suspended non-coding run resume deterministically
  after process restart.
- Audit output can explain every external effect and policy decision.
- A user can pause, approve, deny, resume, and stop a running autonomous task,
  including after a process restart.
- Evaluation fixtures detect state divergence, unauthorized calls, budget drift,
  and broken handoffs.
- Security review has no unresolved critical or high-risk findings.

## Risks and mitigations

- **Risk:** durable transcripts leak private data.
  **Mitigation:** field-level redaction, retention policy, encryption delegated
  to the host, and secret-free fixtures.
- **Risk:** retrying an effect duplicates an irreversible action.
  **Mitigation:** idempotency keys, effect receipts, explicit retry classes, and
  approval for non-idempotent operations.
- **Risk:** evaluation rewards activity instead of useful outcomes.
  **Mitigation:** combine control-plane metrics with task-specific, host-owned
  evaluators and human review where needed.
