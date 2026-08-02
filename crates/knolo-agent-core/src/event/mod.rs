use crate::{ExecutionId, NodeId};
use serde::{Deserialize, Serialize};
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub enum EventKindV1 {
    ExecutionStarted,
    NodeStarted { attempt: u32 },
    StatePatched { revision: u64 },
    Routed { route: String, to: NodeId },
    Retrying { attempt: u32 },
    Suspended { reason: String },
    Terminated,
    Failed { error: String },
    Cancelled,
    Checkpointed,
}
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ExecutionEventV1 {
    pub version: u16,
    pub sequence: u64,
    pub execution_id: ExecutionId,
    pub node_id: Option<NodeId>,
    pub timestamp_ms: u64,
    pub kind: EventKindV1,
}
