# The `@knolo/core` boundary

Knolo Agents depends on, but is separate from, `@knolo/core`. The optional peer
is `@knolo/core` `^5.5.0`. That peer may provide Cortex query/context, ClaimGraph
read/commit, Knowledge Image mount/query, and VQF-1 reconstruction. Agents accept
those capabilities through narrow interfaces and read compressed images only by
calling Core `mount` / `verify`; this repository does not encode VQF. It does not
contain Core source, storage, credentials, transitive runtime, or release process.
Consumers install a compatible core version themselves; Rust hosts implement the
corresponding traits without pretending the external package is bundled.
