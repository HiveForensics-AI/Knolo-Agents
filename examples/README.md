# Examples

`typescript/complete.ts` demonstrates a typed graph, a policy-gated tool boundary,
native retrieval evidence, injected Cortex context, an approved ClaimGraph proposal,
a narrowed multi-agent handoff, HITL validation, checkpoint/event resume concepts,
and deterministic replay. `rust/complete.rs` demonstrates the native host boundary;
the crate copy is runnable. Select the WASM engine explicitly as documented in
`docs/wasm.md`; it never falls back to TypeScript. Every `.knolo` pack grants only
the capability, namespace, call count, and budget used by its named scenario.
For the complete real-pack path, run `cargo run -p knolo-agent --example pack_e2e`;
it loads `packs/agent-e2e.knolo.json`, proves an allowed and denied tool call, and
compares deterministic control-plane replay.
