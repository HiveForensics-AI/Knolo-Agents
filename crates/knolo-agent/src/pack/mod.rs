use knolo_agent_core::{CoreError, GraphId};
use std::{fs, path::Path};

pub use knolo_agent_core::pack::{
    CompiledPolicyV1, PackAgentReferenceV1, PackDeclarationV1, PackManifestV1, PackMetadataV1,
};

#[derive(Debug, Clone, PartialEq)]
pub struct LoadedAgentPackV1 {
    pub pack: PackManifestV1,
    pub agent_id: String,
    pub graph: GraphId,
    pub definition: String,
    pub capabilities: std::collections::BTreeSet<knolo_agent_core::CapabilityId>,
    pub namespaces: std::collections::BTreeSet<knolo_agent_core::NamespaceId>,
    pub policy: CompiledPolicyV1,
}

pub fn load_manifest(source: &str) -> Result<PackManifestV1, CoreError> {
    serde_json::from_str(source).map_err(|e| CoreError::PackLoad(e.to_string()))
}

pub fn load_manifest_file(path: impl AsRef<Path>) -> Result<PackManifestV1, CoreError> {
    let path = path.as_ref();
    let source = fs::read_to_string(path)
        .map_err(|e| CoreError::PackLoad(format!("{}: {e}", path.display())))?;
    load_manifest(&source)
}

pub fn load_agent(source: &str, agent_id: &str) -> Result<LoadedAgentPackV1, CoreError> {
    let pack = load_manifest(source)?;
    let agent = pack.agents.get(agent_id).cloned().ok_or_else(|| {
        CoreError::PackLoad(format!("agent {agent_id} is not referenced by pack"))
    })?;
    if agent
        .capabilities
        .iter()
        .any(|c| pack.capability_bindings.get(c).is_none())
    {
        return Err(CoreError::PackLoad(format!(
            "agent {agent_id} requests an ungranted capability"
        )));
    }
    if agent
        .namespaces
        .iter()
        .any(|n| !pack.namespaces.contains(n))
    {
        return Err(CoreError::PackLoad(format!(
            "agent {agent_id} requests an ungranted namespace"
        )));
    }
    let policy = pack.declaration().compile().map_err(CoreError::PackLoad)?;
    Ok(LoadedAgentPackV1 {
        pack,
        agent_id: agent_id.into(),
        graph: agent.graph.clone(),
        definition: agent.definition.clone(),
        capabilities: agent.capabilities.clone(),
        namespaces: agent.namespaces.clone(),
        policy,
    })
}

pub fn load_agent_file(
    path: impl AsRef<Path>,
    agent_id: &str,
) -> Result<LoadedAgentPackV1, CoreError> {
    let source =
        fs::read_to_string(path.as_ref()).map_err(|e| CoreError::PackLoad(e.to_string()))?;
    load_agent(&source, agent_id)
}
