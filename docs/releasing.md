# Releases and versioning

`knolo-agent`, `knolo-agent-core`, and `@knolo/agents` version independently.
Change the artifact that owns the API; synchronize versions only when their public
contracts require it. Breaking API or contract changes require a major version,
additive APIs a minor version, and compatible fixes a patch. Update compatibility,
changelog/release notes, locks, and fixtures; run all CI and publication dry-runs.
Tags are `knolo-agent-vX.Y.Z`, `knolo-agent-core-vX.Y.Z`, and `agents-vX.Y.Z`.
The WASM adapter currently ships from the workspace and is validated, not separately
published by the release workflow.

`knolo-agent-system/` is the full product workspace and remains an independent
workspace with its own provenance and dependency graph. It is not implicitly
published as `knolo-agent-icp`, `knolo-agent-wasm`, or `@knolo/agents`. A product
release may consume the native runtime and these adapters, but must pass the
same contract, policy, event, checkpoint, and replay gates first.

The supported core integration is the published `@knolo/core` `^5.0.0` line.
V4 is a legacy compatibility/migration path and must not become a new release
dependency or a parallel authority model.
