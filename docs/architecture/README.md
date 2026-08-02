# Architecture

Knolo Agents is organized around explicit, inspectable packs. Rust owns the
runtime and core contracts; TypeScript provides the agent-facing package. The
`@knolo/core` package is an external dependency boundary and is not bundled in
this repository.
