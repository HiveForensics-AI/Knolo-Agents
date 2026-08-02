use knolo_agent_core::{
    tool::{ResourceUsageV1, ToolDefinition},
    CoreError,
};
use serde_json::Value;

/// Host-owned implementation. Credentials may live inside this value but are never serialized.
pub trait ToolImplementation: Send {
    fn definition(&self) -> &ToolDefinition;
    fn execute(&mut self, arguments: &Value) -> Result<(Value, ResourceUsageV1), CoreError>;
}
