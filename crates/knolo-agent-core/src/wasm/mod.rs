use crate::CoreError;
use serde::{Deserialize, Serialize};
use serde_json::Value;

pub const CONTROL_PROTOCOL_VERSION: u16 = 1;
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ControlRequestV1 {
    pub version: u16,
    pub capability: String,
    pub operation: String,
    pub payload: Value,
}
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ControlResponseV1 {
    pub version: u16,
    pub payload: Value,
}
/// The only effect edge available to portable/WASM core code.
pub trait HostCapabilities {
    fn invoke(&mut self, request: &ControlRequestV1) -> Result<ControlResponseV1, CoreError>;
}
