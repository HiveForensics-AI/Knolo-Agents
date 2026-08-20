# Phase 7 — Product surfaces and extensibility

## Objective

Turn the integrated runtime into a coherent Knolo product that can be used in
a terminal, application, service, or embedded host. The surfaces should share
the same agent/profile/pack/run model rather than each inventing its own agent
semantics.

This phase is the concrete install-and-use milestone. It must deliver the
Knolo CLI and interactive experience a person uses to create an agent, give it
a task, watch it work, intervene when required, and inspect the final result.

## Surface strategy

### CLI and TUI

Adapt the useful Grok pager/TUI experience for Knolo concepts: agent picker,
profile inspection, authority preview, run timeline, approvals, workspace
context, handoffs, and resume. Coding workflows should feel excellent without
making shell access the default for other profiles.

The user should be able to see before starting:

- which profile and version will run;
- which tools and data it can access;
- which actions require approval;
- budget and retention limits;
- where the run will execute and persist.

The CLI contract should include equivalents of:

```sh
knolo --version
knolo init
knolo agent list
knolo agent create --template research analyst
knolo agent inspect analyst
knolo run --agent coding "fix the failing tests"
knolo run --agent analyst --file task.md --headless
knolo session list
knolo session resume <run-id>
knolo session logs <run-id>
knolo session stop <run-id>
```

Commands may be subcommands of the same binary, but they must share one
versioned protocol and one run/event model. `knolo run` must support
multi-step execution, tool calls, progress output, structured results, safe
failure recovery, approval prompts, cancellation, and resume.

### TypeScript and application embedding

Extend `@knolo/agents` with typed profile builders, host adapters, run clients,
event subscriptions, and template loading. Keep the portable engine useful for
state/routing and make unsupported effects explicit.

### Headless/API/ACP

Provide a stable headless protocol for CI, services, editor integrations, and
remote execution. ACP can be an adapter, but its sessions must map to Knolo run
IDs, profiles, packs, approvals, and events.

### Extensions

Define versioned extension points for tools, profiles, templates, hooks,
renderers, evaluators, and host adapters. An extension declares its required
capabilities and provenance. Plugins cannot silently modify policy or access
secrets outside host injection.

### Installation and first-run experience

Provide supported installers or release artifacts for the initial host matrix,
first-run configuration, model/provider setup, local workspace selection,
profile creation, update checks, and clean uninstall. The quickstart must take
a new user from install to a successful read-only task and then to an approved
write task.

## Deliverables

- Knolo CLI/TUI product specification and one reference implementation path;
- headless JSON/ACP protocol mapping;
- `@knolo/agents` profile/run/event APIs;
- profile/template registry format;
- extension and plugin manifest with capability declarations;
- user documentation for creating coding, employee, and custom agents;
- install scripts/release artifacts, CLI reference, and first-run quickstart;
- interactive and headless end-to-end task demos;
- accessibility, offline, and failure-state requirements for the TUI.

## Package impact

Keep core behavior in Rust. CLI/TUI targets may be added to `knolo-agent` or
another private composition target without changing published crate boundaries.
The TypeScript product surface remains `@knolo/agents`. `knolo-agent-wasm` and
ICP expose protocol adapters rather than duplicate UI logic.

## Exit criteria

- One profile definition is inspectable and runnable through CLI/TUI, headless,
  and TypeScript paths.
- A clean-machine user can install Knolo, create or select an agent, submit a
  task, observe multi-step execution, and receive a structured result.
- The CLI can pause, approve, resume, inspect, and stop a live run.
- All surfaces show consistent status, authority, approvals, and errors.
- A third-party host can provide a model and tools without depending on a Grok
  internal crate.
- Extensions are versioned, capability-declared, and covered by deny tests.

## Risks and mitigations

- **Risk:** the UI becomes the de facto source of truth.
  **Mitigation:** UI consumes core artifacts and event streams; it does not
  implement policy or state transitions.
- **Risk:** plugin flexibility reintroduces hidden behavior.
  **Mitigation:** manifests, signed or trusted provenance as appropriate,
  explicit host grants, and isolated execution.
- **Risk:** users confuse a profile’s friendly description with its authority.
  **Mitigation:** show the compiled pack and capability diff prominently.
