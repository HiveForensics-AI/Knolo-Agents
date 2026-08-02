# Packs

A `.knolo` pack is reviewable authority, not executable code. It declares an id,
contract version, capability and namespace allowlists, tool constraints, bindings,
and hard budgets. Compilation intersects pack grants with host policy. Missing
grants deny by default. Packs in `examples/packs` intentionally permit one small
scenario each; credentials and implementation details never belong in a pack.

For real loading, use the JSON companion manifest format (`.knolo.json`). It adds
metadata and explicit agent references (`graph`, definition reference,
capabilities, and namespaces). Rust loads it with `knolo_agent::pack::load_agent`
or `load_agent_file`; loading fails before execution when an agent requests a
capability or namespace absent from the pack. The loader consumes references and
authority only; graph and Cortex/ClaimGraph storage remain outside this crate.

Run the complete proof with `cargo run -p knolo-agent --example pack_e2e`. The
example is intentionally a companion manifest rather than a production `.knolo`
binary parser; a future core integration can resolve the same references from
the native pack store without changing the policy boundary.
