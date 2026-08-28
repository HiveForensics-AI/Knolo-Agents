# Compatibility

Contracts are versioned independently from packages. Version 1 readers reject
unknown major versions and resume/replay require exact artifact hashes. Rust crates
support Rust 1.78+; the TypeScript package currently follows the published V5
`@knolo/core` line (`^5.0.0`). V4 remains a legacy migration and compatibility
path. TypeScript and WASM exchange only documented JSON contracts. The release
matrix records each independently versioned artifact and compatible contract.

| Integration | Supported release line | Policy |
| --- | --- | --- |
| `@knolo/core` peer | `^5.0.0` | Primary compatibility path for this framework version. |
| Core V4 | Legacy compatibility | Migration/read-only adapters only; no new framework dependency. |
| `knolo-agent-system` | Independent workspace | Product composition source; not bundled into portable contract crates. |
| ICP/WASM | Optional adapters | Consume the same agent contracts; neither is required for local/server execution. |

The pinned compatibility record is
[`contracts/fixtures/core/compatibility-v5.json`](../contracts/fixtures/core/compatibility-v5.json).
It is metadata only: it does not vendor core or reimplement core-owned storage.

The TypeScript `ExecutionReport.state_snapshots` field is optional for engine
adapters that cannot provide state history; the TypeScript engine supplies it
and `replayDeterministicWithSnapshots` verifies it. Tool results use the V1
effect-receipt shape in [`contracts/fixtures/tools/effect-receipt-v1.json`](../contracts/fixtures/tools/effect-receipt-v1.json).
