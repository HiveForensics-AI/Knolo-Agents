//! Portable harness contracts shared with `@knolo/agents`.
//!
//! This module is parse/validate/digest only. The harness runtime stays in
//! TypeScript. Native L3 execution remains `knolo-agent` / the in-process
//! graph scheduler.

mod cbor;
mod dependency;
mod receipt;
mod task;

pub use dependency::{
    compute_harness_dependency_root, dependency_payload, sort_pack_dependencies,
    HarnessDependencyRootV1, PackDependencyRoleV1, PackDependencyV1, DEPENDENCY_ROOT_LABEL,
};
pub use receipt::{
    EvaluationCheckV1, EvaluationReceiptV1, HarnessRunReceiptV1, InvocationStatusV1,
};
pub use task::{ConstraintV1, HarnessBudgetV1, TaskV1};
