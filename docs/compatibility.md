# Compatibility

Contracts are versioned independently from packages. Version 1 readers reject
unknown major versions and resume/replay require exact artifact hashes. Rust crates
support Rust 1.78+; the TypeScript package supports Node 20+ and `@knolo/core`
`^3.5.0`. TypeScript and WASM exchange only documented JSON contracts. The release
matrix records each independently versioned artifact and compatible contract.
