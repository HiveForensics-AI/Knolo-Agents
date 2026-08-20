# Phase 3 — General agent identity, roles, and memory

## Objective

Turn the current graph-plus-state model into a general agent model that can
represent a coding agent, AI employee, specialist, assistant, or user-created
agent while keeping execution deterministic and authority explicit.

## Proposed model

An agent definition remains a validated graph. Add a profile layer that
describes intent and operating context:

```text
AgentDefinition
├── profile: identity, role, mission, style, success criteria
├── graph: nodes, state schema, transitions, limits
├── pack: capabilities, namespaces, tools, budgets
├── memory: declared stores and read/write rules
├── handoff: delegation and return contracts
└── host requirements: model, workspace, UI, or external services
```

The profile must never be used as a hidden prompt injection or authority grant.
The runtime should expose a compiled, inspectable summary showing what the
agent is allowed to do and what it cannot do.

## Workstreams

### Identity and role

Add stable profile identifiers, display metadata, role/mission text, operating
style, owner, lifecycle state, and success criteria. Separate user-visible
description from system-controlled policy.

### Memory and knowledge

Define memory references and operations rather than embedding a storage system.
Support short-term run memory, durable agent memory, and shared organizational
knowledge through host-injected capabilities. `@knolo/core` remains the place
for Cortex and ClaimGraph implementations.

Every memory operation needs a scope, retention class, provenance, sensitivity
label, and pack grant. Memory writes must be evented and reviewable.

### Instructions and context

Make system instructions, role context, task context, retrieved context, and
tool results distinct typed inputs. This prevents a retrieved document or tool
result from silently becoming policy.

### Templates and custom agents

Define a serializable profile template format that users can duplicate and
modify. Templates refer to packs and host capabilities by stable IDs; they do
not carry credentials or executable code.

## Deliverables

- `AgentProfileV1` and profile validation rules;
- memory reference/capability contracts and redaction rules;
- profile templates for coding, research, operations, and custom agents;
- TypeScript builders and inspection output;
- fixtures showing two profiles running the same graph shape with different
  packs and host capabilities;
- migration notes from current graph-only agent definitions.

## Package impact

Contracts land in `knolo-agent-core`; native compilation and memory host seams
land in `knolo-agent`; builders/templates land in `@knolo/agents`. WASM and ICP
support inspection and transport first, then execution only for their supported
capability sets.

## Exit criteria

- A coding profile and a research or operations profile compile through the same
  path and produce different least-authority policies.
- Profile text, retrieved context, memory, and tool results are distinguishable
  in events and replay artifacts.
- A user can create a custom profile without writing Rust.
- Missing or over-broad memory grants fail closed.

## Risks and mitigations

- **Risk:** “employee” semantics imply unsupervised authority.
  **Mitigation:** model employment as role plus explicit policy, approval, and
  accountability—not as a special privileged runtime mode.
- **Risk:** memory becomes an unbounded data exfiltration path.
  **Mitigation:** scope, retention, sensitivity, redaction, and policy checks
  on every read and write.
- **Risk:** profile templates become executable plugins.
  **Mitigation:** keep templates declarative and route behavior through the
  existing graph and host-effect contracts.
