use knolo_agent_core::{
    checkpoint::CheckpointV1,
    state::{StateSchemaV1, StateSnapshot},
    GraphDefinitionV1,
};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::BTreeMap;

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ProtocolRequest {
    pub version: u16,
    pub command: ProtocolCommand,
    pub graph: GraphDefinitionV1,
    pub schema: Option<StateSchemaV1>,
    pub now_ms: Option<u64>,
}

#[derive(Debug, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum ProtocolCommand {
    Inspect,
    Run {
        execution_id: String,
        state: Value,
    },
    Resume {
        checkpoint: CheckpointV1,
        input: Value,
    },
    Continue {
        session: PortableSession,
        execution: ProtocolNodeExecution,
    },
    Replay,
}

#[derive(Debug, Serialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum ProtocolResponse {
    Inspection {
        inspection: Inspection,
    },
    Event {
        event: ProtocolEvent,
    },
    Dispatch {
        request: DispatchRequest,
        session: PortableSession,
    },
    Report {
        report: ProtocolReport,
    },
    Error {
        failure: Failure,
    },
}

#[derive(Debug, Serialize)]
pub struct Inspection {
    pub engine: &'static str,
    pub graph: GraphDefinitionV1,
    pub capabilities: [&'static str; 3],
    pub limitations: [&'static str; 2],
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProtocolEvent {
    pub version: u16,
    pub sequence: u64,
    pub execution_id: String,
    pub node_id: Option<String>,
    pub timestamp_ms: u64,
    pub kind: ProtocolEventKind,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum ProtocolEventKind {
    ExecutionStarted,
    NodeStarted { attempt: u32 },
    StatePatched { revision: u64 },
    Routed { route: String, to: String },
    Retrying { attempt: u32 },
    Suspended { reason: String },
    Terminated,
    Failed { error: String },
    Cancelled,
    Checkpointed,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DispatchRequest {
    pub node_id: String,
    pub state: Value,
    pub attempt: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ProtocolNodeExecution {
    pub outcome: ProtocolOutcome,
    pub tokens: Option<u64>,
    pub cost_micros: Option<u64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum ProtocolOutcome {
    Continue {
        #[serde(default)]
        patch: Option<Value>,
    },
    Route {
        route: String,
        #[serde(default)]
        patch: Option<Value>,
    },
    Suspend {
        reason: String,
        #[serde(default)]
        patch: Option<Value>,
    },
    Terminate {
        result: Value,
        #[serde(default)]
        patch: Option<Value>,
    },
    Fail {
        error: String,
        #[serde(default)]
        retryable: Option<bool>,
    },
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProtocolReport {
    pub status: ProtocolStatus,
    pub state: StateSnapshot,
    pub events: Vec<ProtocolEvent>,
    pub steps: u64,
    pub tokens: u64,
    pub cost_micros: u64,
    pub snapshots: Vec<StateSnapshot>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum ProtocolStatus {
    Suspended { reason: String },
    Terminated { result: Value },
    Failed { error: String },
    Cancelled,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct PortableSession {
    pub version: u16,
    pub execution_id: String,
    pub graph_hash: String,
    pub state: StateSnapshot,
    pub current_node: String,
    pub sequence: u64,
    pub steps: u64,
    pub tokens: u64,
    pub cost_micros: u64,
    pub snapshots: Vec<StateSnapshot>,
    pub visits: BTreeMap<String, u32>,
    pub start_ms: u64,
    pub awaiting_node: String,
    pub awaiting_attempt: u32,
    pub events: Vec<ProtocolEvent>,
    pub resume_input: Option<Value>,
}

#[derive(Debug, Serialize)]
pub struct Failure {
    #[serde(rename = "type")]
    pub kind: &'static str,
    pub message: String,
}

pub const CAPABILITIES: [&str; 3] = ["state", "routing", "suspension"];
pub const LIMITATIONS: [&str; 2] = [
    "host node handlers use the versioned continue boundary",
    "tools, retrieval, and durable effects stay host-bound",
];
