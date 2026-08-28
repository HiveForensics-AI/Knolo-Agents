# The `@knolo/core` boundary

Knolo Agents depends on, but is separate from, `@knolo/core`. The public core
line is published V5. Core owns Knowledge Images/pack artifacts, verification,
source and evidence identity, deterministic retrieval/query receipts, LivePack,
Cortex, ClaimGraph, and related core runtime primitives. V4 is retained only as
a legacy migration/compatibility path.

The peer dependency is consumed through narrow host adapters. Those adapters
may expose retrieval, Cortex, ClaimGraph, and core artifact inspection to the
agent runtime, but they do not copy core storage or reinterpret core-owned
bytes. A retrieval result must retain its source/evidence identity and, when
available, its query-plan or receipt reference. A successful retrieval never
grants authority to invoke a tool.

This repository does not contain core source, storage, credentials, transitive
runtime, or release process. Consumers install `@knolo/core` `^5.0.0` for the
stable compatibility path; Rust hosts implement the corresponding traits
without pretending the external package is bundled. V4 compatibility must be
explicitly identified as legacy and must not become a parallel authority path.

The first bridge contract is [`packages/agents/src/core/index.ts`](../packages/agents/src/core/index.ts).
Its conformance records live in
[`contracts/fixtures/core/`](../contracts/fixtures/core/). The adapter owns
only translation and capability reporting; core remains authoritative for
artifact bytes, verification, retrieval execution, and durable knowledge state.
