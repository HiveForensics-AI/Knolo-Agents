# Releases and versioning

`knolo-agent`, `knolo-agent-core`, and `@knolo/agents` version independently.
Change the artifact that owns the API; synchronize versions only when their public
contracts require it. Breaking API or contract changes require a major version,
additive APIs a minor version, and compatible fixes a patch. Update compatibility,
changelog/release notes, locks, and fixtures; run all CI and publication dry-runs.
Tags are `knolo-agent-vX.Y.Z`, `knolo-agent-core-vX.Y.Z`, and `agents-vX.Y.Z`.
The WASM adapter currently ships from the workspace and is validated, not separately
published by the release workflow.
