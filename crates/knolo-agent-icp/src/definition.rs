//! Versioned agent definition bundles loaded into the canister.
use knolo_agent_core::{
    graph::{CompiledGraphV1, GraphDefinitionV1},
    pack::{CompiledPolicyV1, PackDeclarationV1},
    state::StateSchemaV1,
    CoreError,
};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

/// Soft ceiling for a single definition JSON payload (ingress-friendly).
pub const MAX_DEFINITION_BYTES: usize = 2 * 1024 * 1024;

/// Host / effects configuration (Phase 2).
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct HostConfigV1 {
    /// When true, Suspend `step_slice` schedules a timer continuation.
    #[serde(default)]
    pub auto_continue: bool,
    /// Timer delay for auto-continue (nanoseconds). Default 1s.
    #[serde(default = "default_timer_ns")]
    pub timer_ns: u64,
    /// Prefer ic-llm for nodes that request LLM effects.
    #[serde(default = "default_true")]
    pub llm_enabled: bool,
    /// Model id string for documentation; mapped to `ic_llm::Model` when known.
    #[serde(default = "default_model")]
    pub llm_model: String,
    /// Optional knowledge canister principal (text). Empty = retrieval disabled.
    #[serde(default)]
    pub knowledge_canister: Option<String>,
    /// Allow HTTPS outcall tools (still pack-gated).
    #[serde(default)]
    pub allow_https_tools: bool,
    /// Max effect resolutions per `start`/`continue_effects` call (instruction guard).
    #[serde(default = "default_max_effect_rounds")]
    pub max_effect_rounds: u32,
}

impl Default for HostConfigV1 {
    fn default() -> Self {
        Self {
            auto_continue: false,
            timer_ns: default_timer_ns(),
            llm_enabled: true,
            llm_model: default_model(),
            knowledge_canister: None,
            allow_https_tools: false,
            max_effect_rounds: default_max_effect_rounds(),
        }
    }
}

fn default_timer_ns() -> u64 {
    1_000_000_000
}
fn default_true() -> bool {
    true
}
fn default_model() -> String {
    "llama3.1:8b".into()
}
fn default_max_effect_rounds() -> u32 {
    8
}

/// JSON envelope accepted by `load_definition`.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct AgentDefinitionBundleV1 {
    pub version: u16,
    /// Built-in node implementation id.
    pub implementation_id: String,
    #[serde(default = "default_hash")]
    pub pack_hash: String,
    #[serde(default = "default_hash")]
    pub policy_hash: String,
    #[serde(default = "default_hash")]
    pub contract_hash: String,
    pub graph: GraphDefinitionV1,
    pub schema: StateSchemaV1,
    /// Optional least-authority pack (tools / namespaces / budgets).
    #[serde(default)]
    pub pack: Option<PackDeclarationV1>,
    #[serde(default)]
    pub host: HostConfigV1,
}

fn default_hash() -> String {
    "none".into()
}

#[derive(Debug, Clone)]
pub struct LoadedDefinition {
    pub bundle: AgentDefinitionBundleV1,
    pub compiled: CompiledGraphV1,
    pub node_implementation_hash: String,
    pub definition_json: String,
    pub policy: Option<CompiledPolicyV1>,
}

impl AgentDefinitionBundleV1 {
    pub fn parse(json: &str) -> Result<Self, CoreError> {
        if json.is_empty() {
            return Err(CoreError::Host("definition JSON was empty".into()));
        }
        if json.len() > MAX_DEFINITION_BYTES {
            return Err(CoreError::Host(format!(
                "definition is too large: {} bytes exceeds the {} byte limit",
                json.len(),
                MAX_DEFINITION_BYTES
            )));
        }
        let bundle: Self = serde_json::from_str(json)
            .map_err(|e| CoreError::Host(format!("invalid definition JSON: {e}")))?;
        if bundle.version != 1 {
            return Err(CoreError::Host(format!(
                "unsupported definition version {}",
                bundle.version
            )));
        }
        if bundle.implementation_id.trim().is_empty() {
            return Err(CoreError::Host(
                "implementation_id must be non-empty".into(),
            ));
        }
        if bundle.schema.id.as_str() != bundle.graph.state_schema.as_str() {
            return Err(CoreError::Host(
                "schema.id must match graph.state_schema".into(),
            ));
        }
        Ok(bundle)
    }

    pub fn load(json: &str) -> Result<LoadedDefinition, CoreError> {
        let bundle = Self::parse(json)?;
        let compiled = bundle.graph.compile()?;
        let node_implementation_hash =
            format!("{:x}", Sha256::digest(bundle.implementation_id.as_bytes()));
        let policy = match &bundle.pack {
            Some(pack) => Some(pack.compile().map_err(CoreError::PackLoad)?),
            None => None,
        };
        Ok(LoadedDefinition {
            bundle,
            compiled,
            node_implementation_hash,
            definition_json: json.to_owned(),
            policy,
        })
    }
}
