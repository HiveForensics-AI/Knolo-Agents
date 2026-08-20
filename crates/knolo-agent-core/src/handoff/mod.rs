//! Inspectable, versioned contracts for subgraph delegation.
use crate::{AgentId, CoreError, ExecutionId, GraphId};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::{BTreeMap, BTreeSet};

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(deny_unknown_fields)]
pub struct AuthorityV1 {
    pub capabilities: BTreeSet<String>,
    pub namespaces: BTreeSet<String>,
    pub max_steps: u64,
    pub max_cost_micros: u64,
}

impl AuthorityV1 {
    pub fn narrowed_by(&self, parent: &Self, pack: &Self) -> Result<(), CoreError> {
        if !self.capabilities.is_subset(&parent.capabilities)
            || !self.capabilities.is_subset(&pack.capabilities)
            || !self.namespaces.is_subset(&parent.namespaces)
            || !self.namespaces.is_subset(&pack.namespaces)
            || self.max_steps > parent.max_steps.min(pack.max_steps)
            || self.max_cost_micros > parent.max_cost_micros.min(pack.max_cost_micros)
        {
            return Err(CoreError::AuthorityEscalation(
                "handoff authority exceeds parent execution or pack policy".into(),
            ));
        }
        Ok(())
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct HandoffEnvelopeV1 {
    pub version: u16,
    pub destination: GraphId,
    /// Destination JSON pointers mapped to parent JSON pointers.
    pub state_projection: BTreeMap<String, String>,
    pub authority_projection: AuthorityV1,
    pub return_contract: String,
}

impl HandoffEnvelopeV1 {
    pub fn validate(&self, parent: &AuthorityV1, pack: &AuthorityV1) -> Result<(), CoreError> {
        if self.version != 1 || self.return_contract.is_empty() {
            return Err(CoreError::InvalidGraph("invalid handoff contract".into()));
        }
        self.authority_projection.narrowed_by(parent, pack)
    }
}

/// Parent/child run metadata around a narrowed handoff. The envelope remains
/// the authority boundary; this wrapper supplies accountability and deadlines.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct DelegationRequestV1 {
    pub version: u16,
    pub parent_run_id: ExecutionId,
    pub child_run_id: ExecutionId,
    pub parent_profile_id: AgentId,
    pub child_profile_id: AgentId,
    pub task: String,
    pub deadline_ms: u64,
    pub envelope: HandoffEnvelopeV1,
}

impl DelegationRequestV1 {
    pub fn validate(&self, parent: &AuthorityV1, pack: &AuthorityV1) -> Result<(), CoreError> {
        if self.version != 1
            || self.task.trim().is_empty()
            || self.deadline_ms == 0
            || self.parent_run_id == self.child_run_id
        {
            return Err(CoreError::InvalidGraph("invalid delegation request".into()));
        }
        self.envelope.validate(parent, pack)
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct DelegationResultV1 {
    pub version: u16,
    pub parent_run_id: ExecutionId,
    pub child_run_id: ExecutionId,
    pub status: String,
    pub result: Option<Value>,
    pub error: Option<String>,
}
