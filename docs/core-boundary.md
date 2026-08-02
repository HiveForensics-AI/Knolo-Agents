# The `@knolo/core` boundary

Knolo Agents depends on, but is separate from, `@knolo/core`. The peer dependency
may provide Cortex query/context and ClaimGraph read/commit capabilities. Agents
accept those capabilities through narrow interfaces. This repository does not
contain its source, storage, credentials, transitive runtime, or release process.
Consumers install a compatible core version themselves; Rust hosts implement the
corresponding traits without pretending the external package is bundled.
