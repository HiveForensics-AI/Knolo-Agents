# WASM

`knolo-agent-wasm` is a WASM-safe, versioned JSON protocol adapter. Build with
`cargo check -p knolo-agent-wasm --target wasm32-unknown-unknown`. TypeScript must
select `engine: "wasm"` and provide an adapter; absence is an error and never causes
a fallback. WASM receives no filesystem, network, clock, or credential authority
unless the embedding host explicitly supplies it.

## ICP canister Wasm (separate path)

`knolo-agent-icp` is a different `wasm32-unknown-unknown` target: an Internet
Computer **host runtime** (Candid + `ic-cdk`), not the browser JSON protocol.
Build with `cargo build -p knolo-agent-icp --target wasm32-unknown-unknown --release`.
See [ADR-001](architecture/adr-001-icp-agent-runtime.md) and
[examples/icp-agent-canister](../examples/icp-agent-canister/).
