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
    pub retry_class: RetryClassV1,
}

/// Retry behavior is part of the tool contract, never inferred from a model
/// request. Hosts may replay an idempotent call with the same key; callers
/// must obtain fresh authorization before retrying a non-idempotent effect.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum RetryClassV1 {
    Safe,
    Idempotent,
    NonIdempotent,
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
    pub receipt: EffectReceiptV1,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct EffectReceiptV1 {
    pub version: u16,
    pub call_id: String,
    pub tool_id: ToolId,
    pub host: String,
    pub idempotency_key: String,
    pub status: EffectStatusV1,
    /// Receipts never carry the raw host result. Hosts may replace this null
    /// with a separately redacted summary before durable persistence.
    pub redacted_output: Value,
    pub resource_delta: ResourceUsageV1,
    pub retry_class: RetryClassV1,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum EffectStatusV1 {
    Executed,
    Denied,
    Failed,
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
