# Contributing to Knolo Agent

The parent repository is the Knolo Agents workspace. Changes to this runtime
source must integrate with the contracts, policy, packs, event model,
checkpoints, and host boundaries documented in the parent `docs/` directory.

## Before changing code

- Read the parent [`AGENTS.md`](../AGENTS.md) and
  [`docs/migration/README.md`](../docs/migration/README.md).
- Identify whether the change is portable contract code, a native host effect,
  a product surface, or third-party/vendor material.
- Preserve source provenance and update [`PROVENANCE.md`](PROVENANCE.md) or the
  relevant notice when adapting code.
- Do not add credentials, provider defaults, or hidden authority to a profile.

## Validation

Run the parent workspace checks for contract or product changes:

```bash
cargo fmt --all --check
cargo test --workspace
pnpm --filter @knolo/agents check
pnpm --filter @knolo/agents test
```

For this harness closure, use targeted package checks. Do not add the harness
workspace to the parent Cargo workspace without an architecture decision.

## Product naming

User-facing names, installation commands, help text, examples, and telemetry
must use Knolo Agent and the `knolo` executable. Historical upstream
identifiers may remain temporarily in internal module paths when required for
provenance; they must not be presented as the public product identity.
