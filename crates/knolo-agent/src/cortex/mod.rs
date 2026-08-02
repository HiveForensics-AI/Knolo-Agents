//! Typed adapters for Cortex capabilities owned and injected by `@knolo/core`.
use knolo_agent_core::CoreError;
use serde_json::Value;

pub trait CortexCapability {
    fn query(&mut self, request: &Value) -> Result<Value, CoreError>;
    fn context(&mut self, request: &Value) -> Result<Value, CoreError>;
}
pub struct CortexQueryNode<C> {
    capability: C,
}
impl<C> CortexQueryNode<C> {
    pub fn new(capability: C) -> Self {
        Self { capability }
    }
}
impl<C: CortexCapability> CortexQueryNode<C> {
    pub fn execute(&mut self, request: &Value) -> Result<Value, CoreError> {
        self.capability.query(request)
    }
}
pub struct CortexContextNode<C> {
    capability: C,
}
impl<C> CortexContextNode<C> {
    pub fn new(capability: C) -> Self {
        Self { capability }
    }
}
impl<C: CortexCapability> CortexContextNode<C> {
    pub fn execute(&mut self, request: &Value) -> Result<Value, CoreError> {
        self.capability.context(request)
    }
}
