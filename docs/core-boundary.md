# The `@knolo/core` boundary

Knolo Agents depends on, but is separate from, `@knolo/core`. The optional peer
is **`^5.1.0`** (Core V5). Agents never vendor Core source, storage, credentials,
or release process.

## What Core owns

- Verifiable Knowledge Images (`verifyKnowledgeImageV5`, `mountKnowledgeImageV5`)
- Deterministic retrieval and evidence receipts
- Authority envelopes and run-authority roots
- Cortex memory (`createCortex`, `remember`, `recall`)
- ClaimGraph storage
- Durable knowledge-run identity

## What Agents owns

- Harness / task / adapter / evaluation semantics
- Legacy injection interfaces (`CortexCapability`, `ClaimGraphCapability`)
- V5 adapters under `packages/agents/src/core-v5/` that **call** Core; they do
  not reimplement Knowledge Image or container semantics

## Compatibility shims

| Legacy surface | Adapter |
| --- | --- |
| `CortexCapability.query` / `context` | `LegacyCortexAdapter` (kept) and `V5CortexAdapter` (maps to Cortex recall) |
| `ClaimGraphCapability.read` / `commit` | `LegacyClaimGraphAdapter` and `V5ClaimGraphAdapter` |

Harness code that needs Core **fails closed** with an explicit error when the
peer is absent. Unit tests stay network-free. `@knolo/core` is a TypeScript
`devDependency` for adapter tests and remains an **optional** peer at publish
time.

Rust hosts implement corresponding traits without pretending the npm package is
bundled. See [the universal harness contract](universal-harness-contract.md).
