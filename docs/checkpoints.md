# Checkpoints and resume

Checkpoints contain state, pending node, event cursor, accumulated budgets, and
hashes for graph, pack, policy, node implementation, and contracts. Stores must
write atomically. Resume verifies every hash before accepting typed input; stale
HITL tokens or changed authority fail closed. The filesystem store uses a temporary
file and atomic rename; production hosts should provide equivalent durability.
