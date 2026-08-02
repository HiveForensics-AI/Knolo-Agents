# WASM

`knolo-agent-wasm` is a WASM-safe, versioned JSON protocol adapter. Build with
`cargo check -p knolo-agent-wasm --target wasm32-unknown-unknown`. TypeScript must
select `engine: "wasm"` and provide an adapter; absence is an error and never causes
a fallback. WASM receives no filesystem, network, clock, or credential authority
unless the embedding host explicitly supplies it.
