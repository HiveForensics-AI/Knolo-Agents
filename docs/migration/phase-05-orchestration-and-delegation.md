# Phase 5 — Delegation, workflows, and multi-agent operations

## Objective

Use the existing graph, handoff, and authority-narrowing foundations to support
real delegation: a manager agent can assign work to specialist agents, receive
structured results, and remain accountable for the combined run.

## Design principles

- Delegation is a typed graph transition or host effect, not an unconstrained
  swarm primitive.
- A child receives a projected state view and a narrowed pack.
- The child has an explicit task, deadline, return schema, and completion
  criteria.
- Parent and child events share correlation IDs and preserve causality.
- A child cannot return authority, secrets, or arbitrary state outside its
  contract.
- Human approval can be required before delegation, before high-risk effects,
  or before accepting a result.

## Workstreams

### Workflow composition

Support reusable workflows that compose agent definitions, tools, approvals,
timers, retries, and terminal outcomes. Prefer declarative graph composition;
if a scripting layer is introduced from the Grok workflow capability, sandbox
it, version it, and keep authority outside the script.

### Delegation protocol

Extend the current handoff envelope with parent/child run IDs, profile IDs,
projected state, task/return schemas, authority delta, budgets, expiry, and
implementation hashes. Validate envelopes before any child execution.

### Organizational patterns

Document and fixture common patterns:

- manager → specialist → verified result;
- planner → workers → reviewer;
- support employee → escalation employee → human approval;
- research employee → claim proposal → ClaimGraph approval/commit.

### Scheduling and concurrency

Add bounded concurrency, cancellation propagation, fairness, and child budget
accounting. A parent budget must include delegated work or explicitly declare a
separate approved budget pool.

## Deliverables

- delegation and return contracts;
- parent/child event correlation and replay fixtures;
- orchestration primitives in `knolo-agent`;
- TypeScript helpers for composing profiles and handoffs;
- at least three end-to-end deterministic workflow examples;
- ClaimGraph collaboration example using propose → approve → commit;
- failure semantics for child timeout, denial, partial result, and parent
  cancellation.

## Package impact

Core contracts extend `knolo-agent-core`; scheduling and child-run management
land in `knolo-agent`; TypeScript composition helpers land in
`@knolo/agents`; ICP support uses stable envelopes and bounded execution;
WASM supports composition only within its documented host limits.

## Exit criteria

- Authority escalation is rejected in tests at compile and execution time.
- Parent runs can resume after a child suspension or failure.
- Budgets and deadlines are attributable across the full delegation tree.
- Results are schema-validated before they modify parent state.
- A non-coding multi-agent workflow works without importing coding workspace
  tools.

## Risks and mitigations

- **Risk:** recursive delegation causes cost or authority explosions.
  **Mitigation:** depth, fan-out, time, token, cost, and capability ceilings in
  compiled policy.
- **Risk:** child output is treated as trusted state.
  **Mitigation:** return schemas, provenance, validation, and optional review.
- **Risk:** orchestration becomes a hidden second scheduler.
  **Mitigation:** parent/child runs use the same core event and checkpoint model.

