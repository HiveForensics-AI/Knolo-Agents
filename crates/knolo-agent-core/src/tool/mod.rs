use crate::{CapabilityId, NamespaceId, ToolId};
use serde::{Deserialize, Serialize};
use serde_json::Value;

/// Public, serializable description of a tool. Host credentials are deliberately absent.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ToolDefinition {
    pub version: u16,
    pub id: ToolId,
    pub namespace: NamespaceId,
    pub capability: CapabilityId,
    pub argument_contract: Value,
    pub result_contract: Value,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ToolCallV1 {
    pub version: u16,
    pub call_id: String,
    pub tool_id: ToolId,
    pub arguments: Value,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ToolResultV1 {
    pub version: u16,
    pub call_id: String,
    pub tool_id: ToolId,
    pub value: Value,
    pub usage: ResourceUsageV1,
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ResourceBudgetV1 {
    pub max_calls: u64,
    pub max_units: u64,
    pub max_duration_ms: u64,
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ResourceUsageV1 {
    pub calls: u64,
    pub units: u64,
    pub duration_ms: u64,
}
