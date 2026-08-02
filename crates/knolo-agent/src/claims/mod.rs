//! ClaimGraph adapters. Storage and mutation remain owned by `@knolo/core`.
use knolo_agent_core::CoreError;
use serde::{Deserialize, Serialize};
use serde_json::Value;

pub trait ClaimGraphCapability {
    fn read(&mut self, query: &Value) -> Result<Value, CoreError>;
    fn commit(&mut self, proposal: &ClaimProposalV1) -> Result<Value, CoreError>;
}
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ClaimProposalV1 {
    pub operation: Value,
    pub justification: String,
}
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum MutationApprovalV1 {
    Policy { decision_id: String },
    Human { reviewer: String },
    Rejected,
}
pub fn commit_proposal<C: ClaimGraphCapability>(
    capability: &mut C,
    proposal: &ClaimProposalV1,
    approval: &MutationApprovalV1,
) -> Result<Value, CoreError> {
    match approval {
        MutationApprovalV1::Policy { decision_id } if !decision_id.is_empty() => {
            capability.commit(proposal)
        }
        MutationApprovalV1::Human { reviewer } if !reviewer.is_empty() => {
            capability.commit(proposal)
        }
        _ => Err(CoreError::ApprovalRequired(
            "ClaimGraph mutation requires explicit policy or human approval".into(),
        )),
    }
}
pub fn read<C: ClaimGraphCapability>(
    capability: &mut C,
    query: &Value,
) -> Result<Value, CoreError> {
    capability.read(query)
}
