use crate::{state::StateSnapshot, CoreError, ExecutionId, NodeId};
use serde::{Deserialize, Serialize};
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct CheckpointV1 {
    pub version: u16,
    pub execution_id: ExecutionId,
    pub graph_hash: String,
    pub pack_hash: String,
    pub policy_hash: String,
    pub node_implementation_hash: String,
    pub contract_hash: String,
    pub state: StateSnapshot,
    pub pending_node: NodeId,
    pub event_cursor: u64,
    pub steps: u64,
    pub tokens: u64,
    pub cost_micros: u64,
}
impl CheckpointV1 {
    pub fn check_compatible(&self, graph: &str, pack: &str, policy: &str) -> Result<(), CoreError> {
        self.check_artifacts(
            graph,
            pack,
            policy,
            &self.node_implementation_hash,
            &self.contract_hash,
        )
    }
    pub fn check_artifacts(
        &self,
        graph: &str,
        pack: &str,
        policy: &str,
        node: &str,
        contract: &str,
    ) -> Result<(), CoreError> {
        if self.version != 1
            || self.graph_hash != graph
            || self.pack_hash != pack
            || self.policy_hash != policy
            || self.node_implementation_hash != node
            || self.contract_hash != contract
        {
            return Err(CoreError::CheckpointIncompatible(
                "graph, pack, policy, node implementation, or contract hash mismatch".into(),
            ));
        }
        Ok(())
    }
}
