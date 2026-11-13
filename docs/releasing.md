# Releases and versioning

`knolo-agent`, `knolo-agent-core`, and `@knolo/agents` version independently.
Change the artifact that owns the API; synchronize versions only when their public
contracts require it. Breaking API or contract changes require a major version,
additive APIs a minor version, and compatible fixes a patch. Update compatibility,
changelog/release notes, locks, and fixtures; run all CI and publication dry-runs.
Tags are `knolo-agent-vX.Y.Z`, `knolo-agent-core-vX.Y.Z`, and `agents-vX.Y.Z`.
The WASM adapter currently ships from the workspace and is validated, not separately
published by the release workflow.

## Publish Knolo Spawn

This release publishes three artifacts from `main`, in order:

| Artifact | Version | Tag |
| --- | --- | --- |
| `knolo-agent-core` | 0.3.0 | `knolo-agent-core-v0.3.0` |
| `knolo-agent` | 0.3.0 | `knolo-agent-v0.3.0` |
| `@knolo/agents` | 0.4.0 | `agents-v0.4.0` |

`knolo-agent-wasm` and `knolo-agent-icp` share the workspace crate version and
stay unpublished (`publish = false`).

`knolo-agent` re-exports `knolo-agent-core`. Publish core and wait until
`0.3.0` is on the crates.io index before publishing `knolo-agent`. The release
workflow checks out the default branch. It does not create git tags, and the
crate path does not compare the version input with `Cargo.toml`.

1. Commit the version bump on the feature branch with a clean `git status`
   (CI fails on a dirty worktree).
2. Merge to `main`. Dispatch Release only after that merge.
3. In GitHub Actions, run **Release** (`workflow_dispatch`) three times:
   1. **artifact:** `knolo-agent-core`, **version:** `0.3.0`. Wait until
      crates.io shows `knolo-agent-core` 0.3.0.
   2. **artifact:** `knolo-agent`, **version:** `0.3.0`.
   3. **artifact:** `agents`, **version:** `0.4.0`.
4. Tag the published commit: `knolo-agent-core-v0.3.0`, `knolo-agent-v0.3.0`,
   and `agents-v0.4.0`.

`cargo publish -p knolo-agent` fails until `knolo-agent-core` 0.3.0 is on the
index. The workflow has no wait between those two runs.

Local dry-run before merge:

```bash
./scripts/hygiene.sh
node scripts/check-links.mjs
node scripts/check-packs.mjs
pnpm install --frozen-lockfile
pnpm --filter @knolo/agents test
test "$(node -p "require('./packages/agents/package.json').version")" = "0.4.0"
cd packages/agents && npm pack --dry-run
cargo package -p knolo-agent-core --list
cargo package -p knolo-agent --list
```
