# Phase 8 — Release, migration, and Knolo-owned productization

## Objective

Complete the transition from an integrated harness to a maintainable Knolo
product, with stable package boundaries, migration tooling, release evidence,
and a clear statement of what Knolo owns and supports. This is the go-live
phase: the result must be installable and usable as a full autonomous agent
product, not merely a renamed source tree.

## Productization workstreams

### Compatibility and migration

Publish converters and guides for current graph definitions, packs, events,
checkpoints, WASM messages, ICP DTOs, and TypeScript APIs. Use explicit schema
versions and compatibility shims; do not reinterpret old artifacts silently.

Provide a migration report that identifies:

- deprecated fields and replacement fields;
- behavior changes in retries, budgets, tool discovery, and approvals;
- unsupported Grok-derived features and their Knolo alternatives;
- required host capabilities and security settings;
- rollback procedure for an in-flight deployment.

### Package and release discipline

Keep the five Knolo package surfaces and `@knolo/core` boundary intact. Decide
which new binaries are release artifacts and which remain private composition
targets. Generate release notes from contract changes, provenance updates,
security reviews, and migration tests.

The release gate must include:

- Rust formatting, check, tests, and security/audit checks;
- TypeScript check, build, tests, and API/type-surface review;
- contract/schema conformance and link checks;
- deterministic evaluation suite;
- license and third-party notice verification;
- supported-host smoke tests;
- checkpoint/replay compatibility tests across the supported upgrade path.

### Ownership and support

Replace source-specific product language, branding, telemetry defaults, and
provider assumptions with Knolo-owned abstractions and defaults. Keep required
attributions and notices for adapted or third-party code. Document the
supported host matrix, data handling, extension policy, and security reporting.

### Final Grok-to-Knolo documentation migration

Perform a repository-wide user-facing migration:

- replace historical upstream product names, logos, URLs, screenshots, CLI names, config paths,
  and provider-specific onboarding in user documentation;
- rewrite the main README, CLI help, quickstart, examples, and troubleshooting
  around Knolo agents and profiles;
- remove imported Grok README files that would confuse users, or replace them
  with Knolo equivalents;
- retain required notices, attribution, licenses, provenance records, and
  third-party documentation needed for compliance and maintenance;
- add a contributor note explaining which components were adapted and where
  their notices live;
- scan built artifacts and release bundles for stale branding and unsupported
  install instructions.

### Full autonomous-agent acceptance

Before GA, run a clean-machine acceptance test that:

1. installs the released Knolo CLI;
2. initializes a user workspace;
3. lists built-in profiles and creates a custom profile;
4. starts a coding task and a non-coding task;
5. verifies multi-step plan/action/observation execution;
6. exercises a policy denial and an approval-required action;
7. pauses, restarts, resumes, and stops a run;
8. inspects event history, final report, budget usage, and audit trail;
9. confirms the same run can be launched headlessly;
10. upgrades or uninstalls without losing documented user data.

The acceptance test is release-blocking and automated where possible.

### Rollout

Use feature gates and opt-in profiles:

1. internal coding-agent dogfood;
2. internal non-coding employee profiles;
3. external developer preview with read-only and approval-heavy defaults;
4. general availability after replay, migration, and security evidence.

Measure adoption and failures through privacy-preserving host telemetry, not by
making telemetry a required runtime effect.

## Deliverables

- v0.2/v0.3/1.0 release proposals;
- migration CLI or library and compatibility matrix;
- final package and host support matrix;
- complete license/provenance and third-party notice bundle;
- security sign-off and incident/rollback runbook;
- product documentation and examples for coding, employee, and custom agents;
- installable Knolo CLI/TUI release artifact;
- clean-machine autonomous task acceptance report;
- stale-branding and documentation migration report;
- release candidate with reproducible deterministic test evidence.

## Exit criteria

- A current Knolo user can upgrade with documented, testable steps.
- A new user can install Knolo from the published instructions and complete a
  real task through the CLI without reading Knolo product documentation.
- Existing packages remain installable and their compatibility guarantees are
  accurate.
- A new user can create and run a non-coding agent without importing coding
  packages or granting shell access.
- A coding agent can use the integrated workspace harness with Knolo policy,
  checkpoints, approvals, and audit.
- Autonomous multi-step runs can be monitored, paused, approved, resumed, and
  stopped from the product surfaces.
- The main README, CLI, examples, and user guides are Knolo-owned; required
  attribution and third-party notices remain available separately.
- All adapted code has required notices and all unsupported capabilities are
  clearly labeled.
- The team can explain, in one sentence, the product: **Knolo is a governed
  runtime and product for creating, running, and supervising any AI agent.**

## Risks and mitigations

- **Risk:** release pressure causes the old and new models to diverge.
  **Mitigation:** one core event/policy/checkpoint model and compatibility tests
  across every surface.
- **Risk:** branding changes hide unresolved technical debt.
  **Mitigation:** GA requires exit criteria, security evidence, and migration
  tooling—not just renamed binaries.
- **Risk:** broad employee profiles ship with excessive authority.
  **Mitigation:** least-authority templates, explicit approvals, default-deny
  packs, and visible capability previews.
