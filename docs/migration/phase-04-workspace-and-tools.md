# Phase 4 — Workspace, tools, and computer-use integration

## Objective

Integrate the strongest Knolo product capabilities—workspace awareness, terminal
execution, file editing, search, code navigation, VCS/worktrees, MCP, and
computer-use adapters—while keeping them optional host capabilities rather
than assumptions baked into every agent.

## Capability groups

### Workspace capability

Extract a host-neutral workspace interface for roots, files, metadata, diffs,
VCS state, worktrees, and change attribution. The local implementation may use
the Grok workspace/codebase graph ideas, but the Knolo contract should also
support remote and virtual workspaces.

### Tool capability

Normalize tools into the existing pack/policy model:

- stable tool ID and version;
- JSON input/output schema;
- capability and namespace requirements;
- argument constraints;
- timeout, cost, and concurrency budget;
- redaction and sensitivity metadata;
- approval requirement and audit event shape.

### Process and computer use

Treat shell, PTY, browser, desktop, and remote computer control as separate
capabilities with separate risk levels. The host owns sandboxing, OS prompts,
credentials, and process lifecycle. The runtime only authorizes and records the
requested effect.

### Protocol adapters

Map MCP and ACP into explicit adapters. MCP servers are tools/data providers;
ACP is a transport/client surface. Neither protocol changes the core authority
model. A tool discovered from a server is unavailable until it is explicitly
bound and granted.

## Likely source mapping

| Grok capability family | Knolo landing zone |
| --- | --- |
| `xai-grok-workspace`, workspace client/types/daemon | `knolo-agent` host workspace module; remote protocol stays adapter-specific |
| `xai-grok-tools`, tools API, computer hub SDK | `knolo-agent` host effects and protocol adapters; core receives normalized DTOs |
| `xai-codebase-graph`, fuzzy search, filesystem events | Optional workspace services behind host traits |
| `xai-fast-worktree`, hunk tracker | Native workspace implementation with pack-gated write operations |
| `xai-grok-sandbox`, secrets, auth | Host/security boundary; never portable core state |
| `xai-acp-lib`, hooks/plugins types | `@knolo/agents` and native protocol adapters, subject to protocol/version review |

## Deliverables

- workspace, process, PTY, file, search, VCS, MCP, and computer-use host traits;
- normalized tool schemas and capability registry;
- coding-agent pack with narrowly scoped development tools;
- non-coding packs demonstrating no-shell operation;
- local sandbox and approval adapter;
- deterministic tool fixtures plus integration tests for deny, timeout, retry,
  cancellation, and redaction;
- workspace capability documentation for local, remote, and read-only modes.

## Package impact

The runtime implementation belongs in `knolo-agent`; portable tool and effect
contracts belong in `knolo-agent-core`; TypeScript host interfaces belong in
`@knolo/agents`. `knolo-agent-wasm` and ICP receive only capabilities supported
by their host constraints.

## Exit criteria

- The coding profile can inspect, edit, test, and review a workspace using
  policy-checked effects and durable events.
- The same runtime can run a research profile with web/document tools and no
  filesystem or shell authority.
- Tool discovery, approval, execution, result, and denial are replayable.
- Secrets never enter graph definitions, packs, event payloads, or checkpoints.

## Risks and mitigations

- **Risk:** the local workspace implementation becomes mandatory.
  **Mitigation:** define capability interfaces first and provide read-only and
  remote hosts as contract tests.
- **Risk:** tool discovery silently expands authority.
  **Mitigation:** discovery is informational; binding and pack grants are
  separate required steps.
- **Risk:** shell/computer use makes “AI employee” unsafe by default.
  **Mitigation:** default custom profiles to no high-risk capabilities and make
  approvals and sandbox policy visible at compile time.

