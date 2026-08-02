# Packs

A `.knolo` pack is reviewable authority, not executable code. It declares an id,
contract version, capability and namespace allowlists, tool constraints, bindings,
and hard budgets. Compilation intersects pack grants with host policy. Missing
grants deny by default. Packs in `examples/packs` intentionally permit one small
scenario each; credentials and implementation details never belong in a pack.
