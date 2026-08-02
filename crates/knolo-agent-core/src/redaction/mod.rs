//! Deterministic redaction applied before data reaches logs or reviewers.
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::BTreeSet;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct RedactionRulesV1 {
    pub version: u16,
    pub json_pointers: BTreeSet<String>,
    pub replacement: String,
}
impl RedactionRulesV1 {
    pub fn apply(&self, value: &Value) -> Value {
        let mut output = value.clone();
        for pointer in &self.json_pointers {
            if let Some(slot) = output.pointer_mut(pointer) {
                *slot = Value::String(self.replacement.clone());
            }
        }
        output
    }
}
