# Phase 1 — Baseline, provenance, and product definition

## Objective

Establish a reliable inventory of the current Knolo system and the
`knolo-product` harness, then define what “make it our own” means in product,
technical, and legal terms. This phase prevents accidental package duplication,
license loss, or a coding-only architecture being renamed as a general agent
platform.

## Workstreams

### 1. Capability inventory

Map the Grok closure into capabilities rather than crate names:

- agent definition and prompt assembly;
- model/session lifecycle and compaction;
- terminal, file, search, VCS, worktree, patch, and test operations;
- workspace discovery, codebase graph, filesystem events, and checkpoints;
- MCP, ACP, hooks, plugins, sandboxing, secrets, telemetry, and updates;
- TUI, headless, editor, and long-running session surfaces.

For each capability record its inputs, side effects, required authority,
durability, privacy implications, and likely Knolo host boundary.

### 2. Package and API baseline

Capture the current public contracts from `knolo-agent-core`, `knolo-agent`,
`knolo-agent-wasm`, `knolo-agent-icp`, and `@knolo/agents`. Freeze a baseline of
schemas, hashes, event kinds, examples, and compatibility tests before adding
new behavior.

### 3. Provenance and licensing register

Record `knolo-product/SOURCE_REV`, the Grok license, `THIRD-PARTY-NOTICES`,
vendored source notices, and all source files selected for extraction. For each
candidate component, record whether it is:

- reimplemented from behavior and public concepts;
- adapted from Apache-2.0 first-party source with required notices;
- third-party code that must remain separately attributed;
- unsuitable for inclusion because its terms, provenance, or coupling are not
  acceptable.

This register is a release artifact, not a private note.

### 4. Product definition

Define the product around an **agent profile** rather than around a coding
session. The first product profiles should be:

- Coding Agent — repository and development execution;
- Research Employee — search, documents, citations, and synthesis;
- Operations Employee — approved business tools, queues, and workflows;
- Custom Agent — user-supplied role, instructions, tools, memory, and policy.

The profile is declarative. It does not grant capabilities or contain secrets.

## Deliverables

- Capability inventory and source-to-capability register;
- package/API compatibility baseline;
- provenance and license register;
- product vocabulary and profile brief;
- threat-model delta covering desktop, server, remote, and delegated agents;
- decision log for components that will be reimplemented, adapted, or rejected.

## Package impact

No package is removed or renamed. Phase 1 may add documentation and contract
fixtures only. `knolo-product` remains an isolated source/reference tree and
is not added to the root Cargo workspace.

## Exit criteria

- Every selected Grok capability has an owner package and a Knolo boundary.
- Every selected source component has a provenance/licensing disposition.
- The product brief demonstrates at least one coding and one non-coding agent
  using the same conceptual runtime.
- Existing Rust and TypeScript checks pass unchanged.
- The team agrees on the `0.2` compatibility policy and migration vocabulary.

## Risks and mitigations

- **Risk:** copying the Grok crate graph wholesale creates a second product.
  **Mitigation:** approve capabilities and contracts, not crate-by-crate merges.
- **Risk:** proprietary or third-party code is mixed into Knolo without review.
  **Mitigation:** provenance register and release gate before extraction.
- **Risk:** “AI employee” becomes a prompt label with no operational model.
  **Mitigation:** require authority, memory, lifecycle, approvals, and audit in
  the profile contract.

