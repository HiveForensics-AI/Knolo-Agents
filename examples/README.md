# Examples

`typescript/complete.ts` demonstrates a typed graph, a policy-gated tool boundary,
native retrieval evidence, injected Cortex context, an approved ClaimGraph proposal,
a narrowed multi-agent handoff, HITL validation, checkpoint/event resume concepts,
and deterministic replay. The runnable Rust examples live in
`crates/knolo-agent/examples/`. Select the WASM engine explicitly as documented in
`docs/wasm.md`; it never falls back to TypeScript. Every `.knolo` pack grants only
the capability, namespace, call count, and budget used by its named scenario.
For the complete real-pack path, run `cargo run -p knolo-agent --example pack_e2e`;
it loads the packaged native fixture, proves an allowed and denied tool call, and
compares deterministic control-plane replay.

The ICP dfx example is a **platform host**, not a harness tutorial. Wrap a
canister with `icpAgent()` and pass that adapter to `createHarness` — see
`examples/adapters/icp/`. ACS dummy-agent baselines live in
`contracts/fixtures/harness/acs/`. Opt-in Hub skill acquisition stages packs
for the next run; see `contracts/fixtures/harness/acquisition/`. Local
experience promotion fixtures live in `contracts/fixtures/harness/experience/`.

Vendor adapters (Grok Build, Grok, OpenClaw) live under
[`examples/adapters/`](adapters/). They wrap host-owned clients around the same
Task / Context / Skill / Registry contracts. Live vendor smoke is
`KNOLO_VENDOR_SMOKE` and is never required for the default unit suite.

Wrapping an existing `Agent.load` app without a rewrite:
[`docs/migration.md`](../docs/migration.md).
