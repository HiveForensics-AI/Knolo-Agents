use crate::{
    event::ExecutionEventV1,
    state::{StatePatch, StateSnapshot},
    CoreError, NodeId,
};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub enum NodeOutcomeV1 {
    Continue {
        patch: StatePatch,
    },
    Route {
        route: String,
        patch: Option<StatePatch>,
    },
    Suspend {
        reason: String,
        patch: Option<StatePatch>,
    },
    Terminate {
        result: serde_json::Value,
        patch: Option<StatePatch>,
    },
    Fail {
        error: String,
        retryable: bool,
    },
}
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct NodeExecutionV1 {
    pub outcome: NodeOutcomeV1,
    pub tokens: u64,
    pub cost_micros: u64,
}
#[derive(Debug)]
pub struct NodeRequest<'a> {
    pub node_id: &'a NodeId,
    pub state: &'a StateSnapshot,
    pub attempt: u32,
}
pub trait NodeExecutor {
    fn execute(&mut self, request: NodeRequest<'_>) -> Result<NodeExecutionV1, CoreError>;
}
pub trait CheckpointStore {
    fn save(&mut self, checkpoint: &crate::checkpoint::CheckpointV1) -> Result<(), CoreError>;
    fn load(
        &self,
        execution: &crate::ExecutionId,
    ) -> Result<Option<crate::checkpoint::CheckpointV1>, CoreError>;
}
pub trait EventSink {
    fn emit(&mut self, event: &ExecutionEventV1) -> Result<(), CoreError>;
}
pub trait Clock {
    fn now_ms(&self) -> u64;
}
