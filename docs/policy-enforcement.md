# Policy enforcement

Before every effect the runtime validates the versioned call, tool allowlist,
namespace, capability binding, argument contract, pack constraints, and remaining
budget. Usage is charged after execution. Denials are structured and auditable.
Handoffs intersect parent, child-pack, and host authority; resume and live replay
require fresh explicit authorization. Host credentials are never serialized.

Each tool definition declares a retry class (`safe`, `idempotent`, or
`non_idempotent`). Every execution attempt emits an `EffectReceiptV1` bound to
the call ID as its idempotency key, host, status, retry class, and resource
delta. Durable receipts contain only a redacted output field; raw host results
remain outside the portable audit record.
