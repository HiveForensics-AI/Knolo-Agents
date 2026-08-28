# Knolo Agent implementation security

Report vulnerabilities through the security process in the parent repository’s
[`SECURITY.md`](../SECURITY.md). Do not publish credentials, exploit details,
or sensitive workspace contents in issues or pull requests.

The harness source is not trusted merely because it is present in this tree.
New capabilities must pass through Knolo packs, host policy, approval rules,
budgets, redaction, checkpoint compatibility, and audit events. Model output,
retrieved data, plugin code, MCP responses, and workspace contents are treated
as untrusted input.

Required legal notices and provenance files are part of the security and release
review surface; do not remove them while changing product branding.
