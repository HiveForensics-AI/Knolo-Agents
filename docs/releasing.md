# Releases and versioning

`knolo-agent`, `knolo-agent-core`, and `@knolo/agents` version independently.
Change the artifact that owns the API; synchronize versions only when their public
contracts require it. Breaking API or contract changes require a major version,
additive APIs a minor version, and compatible fixes a patch. Update compatibility,
changelog/release notes, locks, and fixtures; run all CI and publication dry-runs.
Tags are `knolo-agent-vX.Y.Z`, `knolo-agent-core-vX.Y.Z`, and `agents-vX.Y.Z`.
The WASM adapter currently ships from the workspace and is validated, not separately
published by the release workflow.

## Current workspace versions

| Artifact | In-tree version | Registry | Next publish after harness merge |
| --- | --- | --- | --- |
| `knolo-agent-core` | `0.1.1` | crates.io | `0.2.0` (additive Task / root / receipt JSON) |
| `knolo-agent` | `0.1.1` | crates.io | skip unless native APIs changed |
| `@knolo/agents` | `0.1.3` | npm | `0.2.0` (additive harness; L3 APIs unchanged) |
| `knolo-agent-wasm` | workspace | not published | stays workspace-validated |
| `knolo-agent-icp` | workspace | not published | stays workspace-validated |

Do not tag `1.0.0` yet. Freeze classes are a removal policy, not a published 1.0.

## After this conversion merges

1. Wait for CI green on `main`.
2. Move `[Unreleased]` in [CHANGELOG.md](../CHANGELOG.md) into a dated `0.2.0` section for the artifacts you publish.
3. Bump only those versions (`Cargo.toml` workspace version and/or `packages/agents/package.json`). Keep `knolo-agent-wasm` / `knolo-agent-icp` unpublished.
4. Dry-run:

   ```bash
   cargo package -p knolo-agent-core --list
   cargo package -p knolo-agent --list
   cd packages/agents && npm pack --pack-destination /tmp && tar -tf /tmp/knolo-agents-*.tgz
   ```

5. Run the [Release](../.github/workflows/release.yml) workflow (`workflow_dispatch`) once per artifact: `knolo-agent-core`, then `knolo-agent` if needed, then `agents`. It verifies tests, then `cargo publish` / `pnpm publish --access public`.
6. Push matching git tags (`knolo-agent-core-v0.2.0`, `agents-v0.2.0`).

Required secrets: `CARGO_REGISTRY_TOKEN`, `NPM_TOKEN`. The workflow uses the `release` environment.

## 1.0 freeze (not a version bump)

The universal harness conversion documents freeze classes in
[compatibility.md](compatibility.md). Before tagging 1.0:

- Compatibility matrix matches shipped exports (`packages/agents/tests/api-freeze.test.mjs`).
- Harness fixtures validate against `contracts/schemas/` and parse in both
  TypeScript and `knolo-agent-core`.
- [Migration](migration.md) and the [harness security checklist](security.md)
  describe tested behavior.
- P0 items in `FUTURE.md` (pack-owned run budgets) are closed or explicitly
  deferred in the tag notes. TypeScript state-snapshot replay and portable
  WASM execute/resume are in-tree.
