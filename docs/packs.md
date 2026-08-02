# Packs

A `.knolo` pack is reviewable authority, not executable code. It declares an id,
contract version, capability and namespace allowlists, tool constraints, bindings,
and hard budgets. Compilation intersects pack grants with host policy. Missing
grants deny by default. Packs in `examples/packs` intentionally permit one small
scenario each; credentials and implementation details never belong in a pack.

Native `.knolo` declarations are first-class at the agent boundary. Rust loads
their bytes with `knolo_agent::pack::load_native_pack` (or
`load_native_pack_file`) and binds the resulting authority to an explicit agent
reference with `load_agent_native` (or `load_agent_native_file`). Capabilities,
namespaces, tools, and tool-resource budgets come from the native declaration;
graph/definition references are the small overlay because those definitions are
owned by the core/runtime rather than this crate. Loading fails before
execution when an agent requests a capability or namespace absent from native
authority. The parser is strict about version, identifiers, fields, lists, and
budgets, and rejects malformed or incomplete packs.

The JSON companion manifest remains supported through `load_agent` and
`load_agent_file` for development and compatibility. It cannot override native
authority when `load_agent_native` is used. This checkout’s native `.knolo`
representation is the core pack declaration serialization; a future
`knolo-core-rust` binary store can feed the same `PackDeclarationV1` boundary
without moving policy enforcement or retrieval/storage into agents.
The native `max_steps` and `max_cost_micros` fields are validated but remain
runtime-owned limits until the core runtime exposes them through this contract.

Run the complete proof with `cargo run -p knolo-agent --example pack_e2e`. The
example loads the packaged native fixture, proves an allowed and denied tool
call, and then proves deterministic replay.
