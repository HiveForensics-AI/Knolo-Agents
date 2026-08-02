use crate::{CoreError, ExecutionId, NodeId, StateSchemaId};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::{BTreeMap, BTreeSet};

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub enum ValueType {
    Null,
    Bool,
    Number,
    String,
    Array,
    Object,
}
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct StateSchemaV1 {
    pub version: u16,
    pub id: StateSchemaId,
    pub paths: BTreeMap<String, ValueType>,
    pub required: BTreeSet<String>,
}
impl StateSchemaV1 {
    pub fn validate(&self, value: &Value) -> Result<(), CoreError> {
        if self.version != 1 {
            return Err(CoreError::SchemaViolation(
                "unsupported schema version".into(),
            ));
        }
        for p in &self.required {
            if value.pointer(p).is_none() {
                return Err(CoreError::SchemaViolation(format!(
                    "missing required path {p}"
                )));
            }
        }
        for (p, t) in &self.paths {
            if let Some(v) = value.pointer(p) {
                let actual = match v {
                    Value::Null => ValueType::Null,
                    Value::Bool(_) => ValueType::Bool,
                    Value::Number(_) => ValueType::Number,
                    Value::String(_) => ValueType::String,
                    Value::Array(_) => ValueType::Array,
                    Value::Object(_) => ValueType::Object,
                };
                if &actual != t {
                    return Err(CoreError::SchemaViolation(format!("wrong type at {p}")));
                }
            }
        }
        Ok(())
    }
}
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ProvenanceV1 {
    pub execution_id: ExecutionId,
    pub node_id: NodeId,
    pub event_sequence: u64,
}
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct StateSnapshot {
    pub schema_id: StateSchemaId,
    pub revision: u64,
    pub value: Value,
    pub provenance: Option<ProvenanceV1>,
}
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub enum PatchOperation {
    Set(Value),
    Remove,
}
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct StatePatch {
    pub base_revision: u64,
    pub operations: BTreeMap<String, PatchOperation>,
}
impl StateSnapshot {
    pub fn apply(
        &self,
        patch: &StatePatch,
        allowed: &BTreeSet<String>,
        schema: &StateSchemaV1,
        provenance: ProvenanceV1,
    ) -> Result<Self, CoreError> {
        if patch.base_revision != self.revision {
            return Err(CoreError::RevisionConflict {
                expected: self.revision,
                actual: patch.base_revision,
            });
        }
        let mut value = self.value.clone();
        for (path, op) in &patch.operations {
            if !allowed.contains(path) {
                return Err(CoreError::InvalidPatch(format!(
                    "undeclared write path {path}"
                )));
            }
            apply_op(&mut value, path, op)?;
        }
        schema.validate(&value)?;
        Ok(Self {
            schema_id: self.schema_id.clone(),
            revision: self.revision + 1,
            value,
            provenance: Some(provenance),
        })
    }
}
fn apply_op(root: &mut Value, path: &str, op: &PatchOperation) -> Result<(), CoreError> {
    if !path.starts_with('/') || path.contains("~") {
        return Err(CoreError::InvalidPatch(format!("invalid path {path}")));
    }
    let parts: Vec<_> = path[1..].split('/').collect();
    if parts.iter().any(|p| p.is_empty()) {
        return Err(CoreError::InvalidPatch(format!("invalid path {path}")));
    }
    let (last, parents) = parts.split_last().unwrap();
    let mut at = root;
    for p in parents {
        at = at
            .as_object_mut()
            .and_then(|o| o.get_mut(*p))
            .ok_or_else(|| CoreError::InvalidPatch(format!("missing parent for {path}")))?;
    }
    let obj = at
        .as_object_mut()
        .ok_or_else(|| CoreError::InvalidPatch(format!("parent is not object for {path}")))?;
    match op {
        PatchOperation::Set(v) => {
            obj.insert((*last).into(), v.clone());
        }
        PatchOperation::Remove => {
            if obj.remove(*last).is_none() {
                return Err(CoreError::InvalidPatch(format!("missing path {path}")));
            }
        }
    }
    Ok(())
}
/// Pure reducer: sorted patch paths make its result independent of construction order.
pub fn reduce(
    snapshot: &StateSnapshot,
    patch: &StatePatch,
    writes: &BTreeSet<String>,
    schema: &StateSchemaV1,
    provenance: ProvenanceV1,
) -> Result<StateSnapshot, CoreError> {
    snapshot.apply(patch, writes, schema, provenance)
}
