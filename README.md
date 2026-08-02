# Knolo Agents

Knolo Agents is a Rust runtime and TypeScript SDK for building reliable,
inspectable AI agents. It treats an agent run as a deterministic, reviewable
control plane: typed graphs describe execution, packs grant authority, hosts
provide effects, and ordered events make replay and auditing possible.

## Why it is different

Knolo Agents is not an all-in-one prompt, chain, or provider integration layer.
Compared with LangChain-style frameworks, it puts more of the execution contract
in explicit data structures and less in dynamically assembled application code:

- graph transitions, state schemas, budgets, and effect boundaries are validated;
- `.knolo` packs are least-authority policy inputs, not executable code;
- tools, retrieval, Cortex, ClaimGraph, clocks, and storage are injected by the
  host rather than discovered implicitly;
- Rust owns the authoritative runtime and deterministic event model;
- TypeScript provides ergonomic graph construction and a deliberately limited
  portable engine, with no silent fallback between engines.

This makes the project a good fit for governed workflows, durable automation,
replayable control planes, and applications that need to inspect or constrain
agent authority. It is not intended to replace a model provider, vector store,
job queue, or application-specific data layer.

## Architecture

| Layer | Responsibility |
| --- | --- |
| `knolo-agent-core` | Portable contracts, graph/state validation, policy types, events, replay, checkpoints, and pack declarations. |
| `knolo-agent` | Native Rust scheduler, host effect boundaries, policy enforcement, pack loading, and durable runtime integrations. |
| `knolo-agent-wasm` | Small JSON/WASM protocol adapter for embedding the portable contracts. Not currently published separately. |
| `@knolo/agents` | Typed TypeScript builders, the deterministic state/routing/suspension engine, and explicit WASM integration. |
| `@knolo/core` | Separate peer dependency owned by the consumer; it can provide Cortex and ClaimGraph implementations. |

The repository does not vendor `@knolo/core`, credentials, retrieval storage, or
provider SDKs. See [the architecture overview](docs/architecture/README.md) and
[the core boundary](docs/core-boundary.md).

## Pack-constrained agents

A pack is an authority declaration. It can grant capabilities, namespaces, tools,
argument constraints, and resource budgets. The Rust runtime compiles those
grants into immutable policy and denies unauthorized effects before execution.

Native `.knolo` declarations can be loaded from bytes or files with
`load_native_pack` and `load_agent_native`; graph and definition references are
kept as an explicit overlay because those definitions belong to the surrounding
core/runtime. The validated `.knolo.json` companion manifest remains available
for development and compatibility. See [docs/packs.md](docs/packs.md).

## Quickstart

Rust requires Rust 1.78 or newer:

```bash
cargo test --workspace
cargo run -p knolo-agent --example pack_e2e
```

The example loads a native pack, demonstrates an allowed and denied tool call,
and checks deterministic replay.

For the TypeScript package, use Node 20 or newer and pnpm 9.15:

```bash
corepack enable
pnpm install --frozen-lockfile
pnpm --filter @knolo/agents test
```

The package exports typed builders such as `stateSchema`, `node`, `terminal`,
`transition`, and `defineAgent`, plus `Agent.load` for selecting the TypeScript
or WASM engine explicitly.

## Examples and documentation

- [Rust runtime examples](crates/knolo-agent/examples/)
- [TypeScript example](examples/typescript/complete.ts)
- [Pack declarations](examples/packs/)
- [Documentation index](docs/README.md)
- [Release checklist](docs/releasing.md)

## Current status and limitations

The project is an early `0.1.0` release. The Rust runtime is the authoritative
execution path. The TypeScript engine intentionally supports deterministic state,
routing, and suspension nodes; tool calls, retrieval, durable effects, and
provider integrations require Rust, WASM adapters, or host implementations.

Native pack loading currently consumes the repository’s core pack-declaration
serialization. Agent graph/definition references are an explicit overlay, and
`max_steps`/`max_cost_micros` remain runtime-owned limits until they are exposed
through the shared pack contract. APIs and contracts may evolve before 1.0.

## License

Apache License 2.0. See [LICENSE](LICENSE).
