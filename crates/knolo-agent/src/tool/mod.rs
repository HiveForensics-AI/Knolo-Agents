use knolo_agent_core::CoreError;
use serde_json::Value;

pub use knolo_agent_core::tool::{
    ResourceBudgetV1, ResourceUsageV1, ToolCallV1, ToolDefinition, ToolResultV1,
};

/// Host-owned implementation. Credentials may live inside this value but are never serialized.
pub trait ToolImplementation: Send {
    fn definition(&self) -> &ToolDefinition;
    fn execute(&mut self, arguments: &Value) -> Result<(Value, ResourceUsageV1), CoreError>;
}
