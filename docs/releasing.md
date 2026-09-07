# Releases and versioning

`knolo-agent`, `knolo-agent-core`, and `@knolo/agents` version independently.
Change the artifact that owns the API; synchronize versions only when their public
contracts require it. Breaking API or contract changes require a major version,
additive APIs a minor version, and compatible fixes a patch. Update compatibility,
changelog/release notes, locks, and fixtures; run all CI and publication dry-runs.
Tags are `knolo-agent-vX.Y.Z`, `knolo-agent-core-vX.Y.Z`, and `agents-vX.Y.Z`.
The WASM adapter currently ships from the workspace and is validated, not separately
published by the release workflow.

## Publish `@knolo/agents` 0.3.0

Do **not** republish the Rust crates for this line. They stay `0.2.2` on
crates.io.

1. Commit the 0.3.0 tree with a clean `git status` (CI fails on a dirty worktree).
2. Push the branch and merge to the branch you publish from (`main` once the
   harness work lands, or this feature branch if you are publishing from it).
3. In GitHub Actions, run **Release** (`workflow_dispatch`) with:
   - **artifact:** `agents`
   - **version:** `0.3.0`
4. After npm succeeds, tag `agents-v0.3.0` on the published commit if the
   workflow did not create it.

Local dry-run before dispatch:

```bash
./scripts/hygiene.sh
node scripts/check-links.mjs
node scripts/check-packs.mjs
pnpm install --frozen-lockfile
pnpm --filter @knolo/agents test
test "$(node -p "require('./packages/agents/package.json').version")" = "0.3.0"
cd packages/agents && npm pack --dry-run
```
