# Repository audit

The release checklist inventories `git ls-files`, ignored paths, and symlinks;
rejects generated environments, build/coverage output, secret-shaped files, and
Python packaging manifests; scans text case-insensitively for forbidden legacy
identity and obsolete release variables; and verifies local documentation links.
No images, generated archives, or symlinks are intentionally published.

Workflow environment variables are limited to the standard npm and Cargo publish
tokens in the protected `release` environment. Actions are commit-pinned. Package
metadata, repository URLs, issue forms, CODEOWNERS, license, README, and badges
(if added) must identify only Knolo. Publication dry-runs list the exact crate and
npm tarball contents before publishing; unexpected paths fail review.
