# Policy enforcement

Before every effect the runtime validates the versioned call, tool allowlist,
namespace, capability binding, argument contract, pack constraints, and remaining
budget. Usage is charged after execution. Denials are structured and auditable.
Handoffs intersect parent, child-pack, and host authority; resume and live replay
require fresh explicit authorization. Host credentials are never serialized.
