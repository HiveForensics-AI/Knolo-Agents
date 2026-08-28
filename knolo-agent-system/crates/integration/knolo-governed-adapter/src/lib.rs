//! Adapter boundary between the adapted product workspace and Knolo Agent.
//!
//! Product planners may propose an action, but they do not receive authority
//! from this adapter. The adapter only normalizes and validates the stable
//! `ToolCallV1`; a host must still pass the call through its compiled pack
//! policy and registered effect implementation before execution.

use knolo_agent::policy::validate_call;
use knolo_agent_core::{tool::ToolCallV1, CoreError, ToolId};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::str::FromStr;

pub type AdapterError = CoreError;

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ProductToolRequestV1 {
    pub call_id: String,
    pub tool_id: String,
    pub arguments: Value,
    pub approval_token: Option<String>,
}

/// A validated request ready for the host policy path. Approval is preserved
/// as metadata; it is not treated as a policy decision by this adapter.
#[derive(Debug, Clone, PartialEq)]
pub struct GovernedToolCallV1 {
    pub product_tool_id: String,
    pub call: ToolCallV1,
    pub approval_token: Option<String>,
}

pub fn normalize(request: ProductToolRequestV1) -> Result<GovernedToolCallV1, CoreError> {
    let product_tool_id = request.tool_id.clone();
    let call = ToolCallV1 {
        version: 1,
        call_id: request.call_id,
        tool_id: ToolId::from_str(&canonical_tool_id(&request.tool_id))
            .map_err(|error| CoreError::Host(format!("invalid product tool id: {error}")))?,
        arguments: request.arguments,
    };
    validate_call(&call)?;
    Ok(GovernedToolCallV1 {
        product_tool_id,
        call,
        approval_token: request.approval_token,
    })
}

fn canonical_tool_id(product_tool_id: &str) -> String {
    product_tool_id.replace('_', "-")
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn product_request_becomes_a_validated_core_call() {
        let call = normalize(ProductToolRequestV1 {
            call_id: "product-1".into(),
            tool_id: "workspace.read".into(),
            arguments: json!({"path": "README.md"}),
            approval_token: None,
        })
        .unwrap();
        assert_eq!(call.call.call_id, "product-1");
        assert_eq!(call.product_tool_id, "workspace.read");
        assert_eq!(call.call.tool_id.to_string(), "workspace.read");
    }

    #[test]
    fn product_names_are_canonicalized_without_changing_dispatch_name() {
        let call = normalize(ProductToolRequestV1 {
            call_id: "product-2".into(),
            tool_id: "search_replace".into(),
            arguments: json!({}),
            approval_token: None,
        })
        .unwrap();
        assert_eq!(call.product_tool_id, "search_replace");
        assert_eq!(call.call.tool_id.to_string(), "search-replace");
    }

    #[test]
    fn malformed_product_requests_fail_before_host_execution() {
        let result = normalize(ProductToolRequestV1 {
            call_id: "".into(),
            tool_id: "workspace.read".into(),
            arguments: json!({}),
            approval_token: None,
        });
        assert!(result.is_err());
    }
}
