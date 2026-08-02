use knolo_agent_core::{CapabilityId, CoreError, GraphId, NamespaceId, PackId, ToolId};
use serde_json::Value;
use std::{
    collections::{BTreeMap, BTreeSet},
    fs,
    path::Path,
};

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

/// Load the authority portion of a native `.knolo` pack.
///
/// The native pack format is intentionally parsed here only at the agent/core
/// boundary. Pack contents, retrieval, and storage remain owned by the core
/// runtime. Agent references can be supplied as an overlay when the native
/// pack does not contain agent-specific metadata.
pub fn load_native_pack(source: &[u8]) -> Result<PackDeclarationV1, CoreError> {
    let text = std::str::from_utf8(source)
        .map_err(|e| CoreError::PackLoad(format!("native pack is not UTF-8: {e}")))?;
    parse_native_declaration(text)
}

pub fn load_native_pack_file(path: impl AsRef<Path>) -> Result<PackDeclarationV1, CoreError> {
    let path = path.as_ref();
    let source =
        fs::read(path).map_err(|e| CoreError::PackLoad(format!("{}: {e}", path.display())))?;
    load_native_pack(&source)
}

/// Load an agent using native pack authority and an explicit agent reference.
/// Native authority is authoritative for capabilities, namespaces, tools, and
/// budgets; the overlay supplies graph/definition references only.
pub fn load_agent_native(
    source: &[u8],
    agent_id: &str,
    agent: PackAgentReferenceV1,
) -> Result<LoadedAgentPackV1, CoreError> {
    let declaration = load_native_pack(source)?;
    let pack = manifest_from_declaration(&declaration, agent_id, agent.clone())?;
    load_agent_with_declaration(pack, agent_id, declaration)
}

pub fn load_agent_native_file(
    path: impl AsRef<Path>,
    agent_id: &str,
    agent: PackAgentReferenceV1,
) -> Result<LoadedAgentPackV1, CoreError> {
    let source = fs::read(path.as_ref())
        .map_err(|e| CoreError::PackLoad(format!("{}: {e}", path.as_ref().display())))?;
    load_agent_native(&source, agent_id, agent)
}

pub fn load_manifest_file(path: impl AsRef<Path>) -> Result<PackManifestV1, CoreError> {
    let path = path.as_ref();
    let source = fs::read_to_string(path)
        .map_err(|e| CoreError::PackLoad(format!("{}: {e}", path.display())))?;
    load_manifest(&source)
}

pub fn load_agent(source: &str, agent_id: &str) -> Result<LoadedAgentPackV1, CoreError> {
    let pack = load_manifest(source)?;
    pack.agents.get(agent_id).ok_or_else(|| {
        CoreError::PackLoad(format!("agent {agent_id} is not referenced by pack"))
    })?;
    load_agent_with_declaration(pack.clone(), agent_id, pack.declaration())
}

fn load_agent_with_declaration(
    pack: PackManifestV1,
    agent_id: &str,
    declaration: PackDeclarationV1,
) -> Result<LoadedAgentPackV1, CoreError> {
    let agent = pack.agents.get(agent_id).cloned().ok_or_else(|| {
        CoreError::PackLoad(format!("agent {agent_id} is not referenced by pack"))
    })?;
    if agent
        .capabilities
        .iter()
        .any(|c| !declaration.capability_bindings.contains_key(c))
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
    let policy = declaration.compile().map_err(CoreError::PackLoad)?;
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

fn manifest_from_declaration(
    declaration: &PackDeclarationV1,
    agent_id: &str,
    agent: PackAgentReferenceV1,
) -> Result<PackManifestV1, CoreError> {
    let mut agents = BTreeMap::new();
    if agents.insert(agent_id.to_owned(), agent).is_some() {
        return Err(CoreError::PackLoad(
            "duplicate native agent reference".into(),
        ));
    }
    Ok(PackManifestV1 {
        version: declaration.version,
        id: declaration.id.clone(),
        metadata: PackMetadataV1 {
            name: declaration.id.as_str().to_owned(),
            description: "native .knolo pack".into(),
        },
        agents,
        tools: declaration.tools.clone(),
        namespaces: declaration.namespaces.clone(),
        argument_constraints: declaration.argument_constraints.clone(),
        budget: declaration.budget.clone(),
        capability_bindings: declaration.capability_bindings.clone(),
    })
}

fn parse_native_declaration(source: &str) -> Result<PackDeclarationV1, CoreError> {
    let mut version = None;
    let mut id = None;
    let mut tools = BTreeSet::new();
    let mut capabilities = BTreeSet::new();
    let mut namespaces = BTreeSet::new();
    let mut budget = knolo_agent_core::tool::ResourceBudgetV1::default();
    let mut seen = BTreeSet::new();
    let mut section = "";
    for raw in source.lines() {
        let line = raw.trim_end();
        if line.trim().is_empty() {
            continue;
        }
        let trimmed = line.trim();
        let indent = line.len() - line.trim_start().len();
        let (key, value) = trimmed
            .split_once(':')
            .ok_or_else(|| invalid_native(line))?;
        let key = key.trim();
        let value = value.trim();
        if indent == 0 {
            if !seen.insert(key.to_owned()) {
                return Err(invalid_native(line));
            }
            section = key;
            match key {
                "version" => version = Some(parse_u16(value, key)?),
                "id" => id = Some(value.parse::<PackId>().map_err(|e| invalid_value(key, e))?),
                "tools" => tools = parse_ids::<ToolId>(value, key)?,
                "authority" | "budget" => {}
                _ => return Err(invalid_native(line)),
            }
        } else if indent == 2 && matches!(section, "authority" | "budget") {
            if !seen.insert(format!("{section}.{key}")) {
                return Err(invalid_native(line));
            }
            match (section, key) {
                ("authority", "capabilities") => {
                    capabilities = parse_ids::<CapabilityId>(value, key)?
                }
                ("authority", "namespaces") => namespaces = parse_ids::<NamespaceId>(value, key)?,
                ("budget", "max_calls") => budget.max_calls = parse_u64(value, key)?,
                ("budget", "max_units") => budget.max_units = parse_u64(value, key)?,
                ("budget", "max_duration_ms") => budget.max_duration_ms = parse_u64(value, key)?,
                // These are native pack limits owned by the broader runtime.
                // The agent policy currently enforces tool-resource limits only.
                ("budget", "max_steps") | ("budget", "max_cost_micros") => {
                    parse_u64(value, key)?;
                }
                _ => return Err(invalid_native(line)),
            }
        } else {
            return Err(invalid_native(line));
        }
    }
    if version != Some(1) || id.is_none() || budget.max_calls == 0 {
        return Err(CoreError::PackLoad(
            "native pack is incomplete or unsupported".into(),
        ));
    }
    let capability_bindings = capabilities
        .into_iter()
        .map(|c| (c.clone(), c.as_str().into()))
        .collect();
    Ok(PackDeclarationV1 {
        version: 1,
        id: id.unwrap(),
        tools,
        namespaces,
        argument_constraints: BTreeMap::<ToolId, Value>::new(),
        budget,
        capability_bindings,
    })
}

fn parse_ids<T>(value: &str, field: &str) -> Result<BTreeSet<T>, CoreError>
where
    T: Ord + std::str::FromStr,
    T::Err: std::fmt::Display,
{
    let value = value
        .strip_prefix('[')
        .and_then(|v| v.strip_suffix(']'))
        .ok_or_else(|| CoreError::PackLoad(format!("native {field} must be a bracketed list")))?;
    value
        .split(',')
        .map(str::trim)
        .filter(|v| !v.is_empty())
        .map(|v| v.parse().map_err(|e| invalid_value(field, e)))
        .collect()
}
fn parse_u64(value: &str, field: &str) -> Result<u64, CoreError> {
    value.parse().map_err(|e| invalid_value(field, e))
}
fn parse_u16(value: &str, field: &str) -> Result<u16, CoreError> {
    value.parse().map_err(|e| invalid_value(field, e))
}
fn invalid_value(field: &str, error: impl std::fmt::Display) -> CoreError {
    CoreError::PackLoad(format!("invalid native {field}: {error}"))
}
fn invalid_native(line: &str) -> CoreError {
    CoreError::PackLoad(format!("invalid native pack line: {line}"))
}

pub fn load_agent_file(
    path: impl AsRef<Path>,
    agent_id: &str,
) -> Result<LoadedAgentPackV1, CoreError> {
    let source =
        fs::read_to_string(path.as_ref()).map_err(|e| CoreError::PackLoad(e.to_string()))?;
    load_agent(&source, agent_id)
}
