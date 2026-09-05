use serde::{Deserialize, Serialize};
use serde_json::Value;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum InvocationStatusV1 {
    Succeeded,
    Partial,
    Failed,
    Suspended,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EvaluationCheckV1 {
    pub phase: String,
    pub id: String,
    pub passed: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub detail: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EvaluationReceiptV1 {
    pub status: InvocationStatusV1,
    pub success_criteria_matched: Vec<String>,
    pub prohibited_violations: Vec<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub passed: Option<bool>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub checks: Vec<EvaluationCheckV1>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub judge: Option<Value>,
}

/// Portable HarnessRunReceiptV1. Separate family from ExecutionEventV1.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct HarnessRunReceiptV1 {
    pub version: u16,
    pub run_id: String,
    pub agent_descriptor_hash: String,
    pub task_root: String,
    pub input_root: String,
    pub knowledge_state_roots: Vec<String>,
    pub harness_dependency_root: String,
    pub authority_root: String,
    pub skill_selection_receipt: Option<String>,
    pub evidence_receipts: Vec<String>,
    pub tool_receipts: Vec<String>,
    pub evaluation_receipt: EvaluationReceiptV1,
    pub recovery_events: Vec<Value>,
    pub final_status: InvocationStatusV1,
    pub output: Value,
}

impl HarnessRunReceiptV1 {
    pub fn parse(value: &str) -> Result<Self, crate::CoreError> {
        let receipt: Self = serde_json::from_str(value)
            .map_err(|error| crate::CoreError::SchemaViolation(error.to_string()))?;
        if receipt.version != 1 {
            return Err(crate::CoreError::SchemaViolation(
                "HarnessRunReceiptV1.version must be 1".into(),
            ));
        }
        Ok(receipt)
    }
}
