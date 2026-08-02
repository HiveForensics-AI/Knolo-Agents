use crate::{tool::ResourceBudgetV1, CapabilityId, GraphId, NamespaceId, PackId, ToolId};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::{BTreeMap, BTreeSet};

/// Parsed `.knolo` authority declaration. It contains references, never capability values.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct PackDeclarationV1 {
    pub version: u16,
    pub id: PackId,
    pub tools: BTreeSet<ToolId>,
    pub namespaces: BTreeSet<NamespaceId>,
    pub argument_constraints: BTreeMap<ToolId, Value>,
    pub budget: ResourceBudgetV1,
    pub capability_bindings: BTreeMap<CapabilityId, String>,
}

/// A real, JSON-serializable pack manifest consumed by the agent boundary.
/// The referenced graph/definition contents are owned by the caller or core;
/// this manifest only records the authority and references.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct PackManifestV1 {
    pub version: u16,
    pub id: PackId,
    pub metadata: PackMetadataV1,
    pub agents: BTreeMap<String, PackAgentReferenceV1>,
    pub tools: BTreeSet<ToolId>,
    pub namespaces: BTreeSet<NamespaceId>,
    pub argument_constraints: BTreeMap<ToolId, Value>,
    pub budget: ResourceBudgetV1,
    pub capability_bindings: BTreeMap<CapabilityId, String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct PackMetadataV1 {
    pub name: String,
    pub description: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct PackAgentReferenceV1 {
    pub graph: GraphId,
    pub definition: String,
    pub capabilities: BTreeSet<CapabilityId>,
    pub namespaces: BTreeSet<NamespaceId>,
}

impl PackManifestV1 {
    pub fn declaration(&self) -> PackDeclarationV1 {
        PackDeclarationV1 {
            version: self.version,
            id: self.id.clone(),
            tools: self.tools.clone(),
            namespaces: self.namespaces.clone(),
            argument_constraints: self.argument_constraints.clone(),
            budget: self.budget.clone(),
            capability_bindings: self.capability_bindings.clone(),
        }
    }
}

/// Immutable, pack-derived authority used by a host execution.
#[derive(Debug, Clone, PartialEq)]
pub struct CompiledPolicyV1 {
    allowed_tools: BTreeSet<ToolId>,
    namespaces: BTreeSet<NamespaceId>,
    constraints: BTreeMap<ToolId, Value>,
    budget: ResourceBudgetV1,
    bindings: BTreeMap<CapabilityId, String>,
}
impl PackDeclarationV1 {
    pub fn compile(&self) -> Result<CompiledPolicyV1, String> {
        if self.version != 1 || self.budget.max_calls == 0 {
            return Err("unsupported pack or zero call budget".into());
        }
        if self
            .argument_constraints
            .keys()
            .any(|t| !self.tools.contains(t))
        {
            return Err("constraint references undeclared tool".into());
        }
        Ok(CompiledPolicyV1 {
            allowed_tools: self.tools.clone(),
            namespaces: self.namespaces.clone(),
            constraints: self.argument_constraints.clone(),
            budget: self.budget.clone(),
            bindings: self.capability_bindings.clone(),
        })
    }
}
impl CompiledPolicyV1 {
    pub fn allows_tool(&self, t: &ToolId) -> bool {
        self.allowed_tools.contains(t)
    }
    pub fn allows_namespace(&self, n: &NamespaceId) -> bool {
        self.namespaces.contains(n)
    }
    pub fn constraint(&self, t: &ToolId) -> Option<&Value> {
        self.constraints.get(t)
    }
    pub fn budget(&self) -> &ResourceBudgetV1 {
        &self.budget
    }
    pub fn binding(&self, c: &CapabilityId) -> Option<&str> {
        self.bindings.get(c).map(String::as_str)
    }
}
