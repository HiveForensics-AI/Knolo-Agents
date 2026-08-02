use crate::{NamespaceId, ToolId};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum PolicyDenialCodeV1 {
    InvalidContract,
    ToolNotFound,
    ToolNotAllowed,
    NamespaceDenied,
    ArgumentDenied,
    BudgetExhausted,
    ResultInvalid,
    CapabilityUnavailable,
}

/// Stable denial shape safe to persist in audit streams.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct PolicyDenialV1 {
    pub version: u16,
    pub code: PolicyDenialCodeV1,
    pub tool_id: Option<ToolId>,
    pub namespace: Option<NamespaceId>,
    pub message: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct RouteDecisionV1 {
    pub version: u16,
    pub route: String,
    pub reason: String,
}
