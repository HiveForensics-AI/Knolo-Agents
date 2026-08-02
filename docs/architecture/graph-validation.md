# Graph validation

Compilation rejects unsupported versions, duplicate or malformed identifiers,
missing entry/terminal nodes, unreachable nodes, unknown transition endpoints,
duplicate routes, unbounded cycles, invalid read/write paths, and non-positive
limits. Validation precedes execution and produces a content hash used by resume
and replay compatibility checks.
