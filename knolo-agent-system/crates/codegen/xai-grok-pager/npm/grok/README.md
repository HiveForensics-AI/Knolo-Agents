# Knolo runtime package placeholder

This directory is retained as an internal platform-package location while the
terminal harness is being extracted into the Knolo product. It is not the
public npm installation path.

Use the native Knolo CLI from the parent workspace:

```bash
cargo install --path crates/knolo-agent --bin knolo
knolo init
knolo agent list
knolo run --agent coding "list files"
```

The public TypeScript package is `@knolo/agents` in the parent workspace. Its
role is typed profile/graph construction and host integration; it does not bundle
provider credentials or this internal harness.

Do not publish this placeholder independently until the package has a Knolo
manifest, release artifact, provenance review, and compatibility tests.
