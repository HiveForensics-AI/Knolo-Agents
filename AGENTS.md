# Knolo Agents contributor guide

Knolo Agents is a Rust and TypeScript workspace. Keep the repository explicit,
small, and independently usable: runtime behavior belongs in Rust, while
TypeScript exposes ergonomic interfaces for consumers.

## Workspace conventions

- Rust crates live under `crates/` and are members of the root Cargo workspace.
- TypeScript packages live under `packages/` and are managed with pnpm.
- Shared schemas and deterministic examples belong in `contracts/` and
  `examples/`; architecture decisions belong in `docs/architecture/`.
- Treat `@knolo/core` as a dependency boundary. Do not copy or vendor its
  implementation into this repository.
- Prefer explicit configuration and validation over hidden behavior.

## Development commands

Use the committed pnpm lockfile and the package manager declared in the root
`package.json`.

```bash
cargo fmt --all --check
cargo check --workspace
cargo test --workspace
pnpm install --frozen-lockfile
pnpm --filter @knolo/agents check
```

All Rust functions and public TypeScript APIs should have clear types. Add
focused tests for behavior changes, keep fixtures deterministic, and avoid
network access in unit tests.

## Change discipline

Preserve public API compatibility unless a change is intentional and documented.
Keep generated output, local secrets, editor state, and build artifacts
untracked. Update schemas and fixtures together when a contract changes.
