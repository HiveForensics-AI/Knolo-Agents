use super::cbor::canonical_cbor;
use crate::CoreError;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};

pub const DEPENDENCY_ROOT_LABEL: &str = "knolo.harness.dependencies.v1";

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum PackDependencyRoleV1 {
    Knowledge,
    Skill,
    Policy,
    Evaluation,
    Workflow,
}

impl PackDependencyRoleV1 {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Knowledge => "knowledge",
            Self::Skill => "skill",
            Self::Policy => "policy",
            Self::Evaluation => "evaluation",
            Self::Workflow => "workflow",
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PackDependencyV1 {
    pub name: String,
    pub version: String,
    pub sha256: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub state_root: Option<String>,
    pub role: PackDependencyRoleV1,
}

impl PackDependencyV1 {
    pub fn validate(&self) -> Result<(), CoreError> {
        if self.name.trim().is_empty() {
            return Err(CoreError::SchemaViolation(
                "pack dependency name is required".into(),
            ));
        }
        if self.version.trim().is_empty() {
            return Err(CoreError::SchemaViolation(format!(
                "pack dependency '{}' is missing version",
                self.name
            )));
        }
        if self.sha256.len() != 64
            || !self
                .sha256
                .chars()
                .all(|c| matches!(c, '0'..='9' | 'a'..='f'))
        {
            return Err(CoreError::SchemaViolation(format!(
                "pack dependency '{}' sha256 must be 64 lowercase hex characters",
                self.name
            )));
        }
        Ok(())
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct HarnessDependencyRootV1 {
    pub version: u16,
    pub algorithm: String,
    pub dependencies: Vec<PackDependencyV1>,
    pub root: String,
}

impl HarnessDependencyRootV1 {
    pub fn parse(value: &str) -> Result<Self, CoreError> {
        let parsed: Self = serde_json::from_str(value)
            .map_err(|error| CoreError::SchemaViolation(error.to_string()))?;
        if parsed.version != 1 || parsed.algorithm != DEPENDENCY_ROOT_LABEL {
            return Err(CoreError::SchemaViolation(
                "HarnessDependencyRootV1 algorithm/version mismatch".into(),
            ));
        }
        for item in &parsed.dependencies {
            item.validate()?;
        }
        Ok(parsed)
    }
}

pub fn sort_pack_dependencies(dependencies: &[PackDependencyV1]) -> Vec<PackDependencyV1> {
    let mut items = dependencies.to_vec();
    items.sort_by(|left, right| {
        left.name
            .cmp(&right.name)
            .then(left.role.as_str().cmp(right.role.as_str()))
            .then(left.sha256.cmp(&right.sha256))
            .then(left.version.cmp(&right.version))
    });
    items
}

pub fn dependency_payload(dependencies: &[PackDependencyV1]) -> Value {
    Value::Array(
        sort_pack_dependencies(dependencies)
            .into_iter()
            .map(|item| {
                let mut map = serde_json::Map::new();
                map.insert("name".into(), json!(item.name));
                map.insert("role".into(), json!(item.role.as_str()));
                map.insert("sha256".into(), json!(item.sha256));
                if let Some(state_root) = item.state_root {
                    map.insert("stateRoot".into(), json!(state_root));
                }
                map.insert("version".into(), json!(item.version));
                Value::Object(map)
            })
            .collect(),
    )
}

pub fn compute_harness_dependency_root(
    dependencies: &[PackDependencyV1],
) -> Result<HarnessDependencyRootV1, CoreError> {
    let sorted = sort_pack_dependencies(dependencies);
    for item in &sorted {
        item.validate()?;
    }
    let payload = dependency_payload(&sorted);
    let cbor = canonical_cbor(&payload)?;
    let mut framed = Vec::with_capacity(DEPENDENCY_ROOT_LABEL.len() + 1 + cbor.len());
    framed.extend_from_slice(DEPENDENCY_ROOT_LABEL.as_bytes());
    framed.push(0);
    framed.extend_from_slice(&cbor);
    let digest = Sha256::digest(&framed);
    Ok(HarnessDependencyRootV1 {
        version: 1,
        algorithm: DEPENDENCY_ROOT_LABEL.into(),
        dependencies: sorted,
        root: format!("{DEPENDENCY_ROOT_LABEL}:{:x}", digest),
    })
}
