use crate::CoreError;
use serde::{Deserialize, Serialize};
use serde_json::Value;

/// Token / step / cost budget attached to a harness task.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct HarnessBudgetV1 {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub max_steps: Option<u64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub max_tokens: Option<u64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub max_cost_micros: Option<u64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub timeout_ms: Option<u64>,
}

impl HarnessBudgetV1 {
    pub fn validate(&self) -> Result<(), CoreError> {
        for (name, value) in [
            ("maxSteps", self.max_steps),
            ("maxTokens", self.max_tokens),
            ("maxCostMicros", self.max_cost_micros),
            ("timeoutMs", self.timeout_ms),
        ] {
            if matches!(value, Some(0)) {
                return Err(CoreError::SchemaViolation(format!(
                    "task.budget.{name} must be a positive integer"
                )));
            }
        }
        Ok(())
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ConstraintV1 {
    pub id: String,
    pub description: String,
}

/// Portable TaskV1 contract shared with `@knolo/agents`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct TaskV1 {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub id: Option<String>,
    pub objective: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub inputs: Option<Value>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub constraints: Option<Vec<ConstraintV1>>,
    pub success_criteria: Vec<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub required_capabilities: Option<Vec<String>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub preferred_skills: Option<Vec<String>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub prohibited_actions: Option<Vec<String>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub budget: Option<HarnessBudgetV1>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub deadline_ms: Option<u64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub output_schema: Option<Value>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub evidence_requirements: Option<Vec<String>>,
}

impl TaskV1 {
    pub fn parse(value: &str) -> Result<Self, CoreError> {
        let task: Self = serde_json::from_str(value)
            .map_err(|error| CoreError::SchemaViolation(error.to_string()))?;
        task.validate()?;
        Ok(task)
    }

    pub fn validate(&self) -> Result<(), CoreError> {
        if self.objective.trim().is_empty() {
            return Err(CoreError::SchemaViolation(
                "task.objective must be a non-empty string".into(),
            ));
        }
        if self.success_criteria.is_empty()
            || self
                .success_criteria
                .iter()
                .any(|item| item.trim().is_empty())
        {
            return Err(CoreError::SchemaViolation(
                "task.successCriteria must contain at least one non-empty criterion".into(),
            ));
        }
        if let Some(id) = &self.id {
            if !regex_identifier(id) {
                return Err(CoreError::InvalidIdentifier(id.clone()));
            }
        }
        if let Some(budget) = &self.budget {
            budget.validate()?;
        }
        if matches!(self.deadline_ms, Some(0)) {
            return Err(CoreError::SchemaViolation(
                "task.deadlineMs must be a positive integer".into(),
            ));
        }
        Ok(())
    }
}

fn regex_identifier(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 128
        && value
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, '-' | '_' | '.' | '/'))
}
