use crate::{AgentId, CoreError, MemoryScopeV1, NamespaceId};
use serde::{Deserialize, Serialize};

/// The product-level role of an agent. Roles describe intent; packs grant authority.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum AgentProfileKindV1 {
    Coding,
    Research,
    Operations,
    Custom,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum AgentLifecycleV1 {
    Draft,
    Active,
    Paused,
    Retired,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct AutonomyLimitsV1 {
    pub max_turns: u32,
    pub max_actions: u32,
    pub max_retries: u32,
    pub timeout_ms: u64,
    pub require_approval_for_writes: bool,
}

impl Default for AutonomyLimitsV1 {
    fn default() -> Self {
        Self {
            max_turns: 8,
            max_actions: 32,
            max_retries: 1,
            timeout_ms: 300_000,
            require_approval_for_writes: true,
        }
    }
}

impl AutonomyLimitsV1 {
    pub fn validate(&self) -> Result<(), CoreError> {
        if self.max_turns == 0 || self.max_actions == 0 || self.timeout_ms == 0 {
            return Err(CoreError::InvalidProfile(
                "autonomy limits must be positive".into(),
            ));
        }
        Ok(())
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct AgentProfileV1 {
    pub version: u16,
    pub id: AgentId,
    pub name: String,
    pub description: String,
    pub kind: AgentProfileKindV1,
    pub mission: String,
    pub capabilities: Vec<String>,
    pub model: Option<String>,
    pub autonomy: AutonomyLimitsV1,
    #[serde(default)]
    pub operating_style: String,
    #[serde(default)]
    pub owner: Option<String>,
    #[serde(default)]
    pub lifecycle: Option<AgentLifecycleV1>,
    #[serde(default)]
    pub success_criteria: Vec<String>,
    #[serde(default)]
    pub memory_scopes: Vec<MemoryScopeV1>,
}

impl AgentProfileV1 {
    pub fn validate(&self) -> Result<(), CoreError> {
        if self.version != 1 {
            return Err(CoreError::InvalidProfile(
                "unsupported agent profile version".into(),
            ));
        }
        if self.name.trim().is_empty() || self.mission.trim().is_empty() {
            return Err(CoreError::InvalidProfile(
                "agent name and mission are required".into(),
            ));
        }
        self.autonomy.validate()?;
        let mut namespaces = std::collections::BTreeSet::new();
        for scope in &self.memory_scopes {
            scope.validate()?;
            if !namespaces.insert(scope.namespace.clone()) {
                return Err(CoreError::InvalidProfile(
                    "duplicate memory namespace".into(),
                ));
            }
        }
        Ok(())
    }

    pub fn builtin(kind: AgentProfileKindV1, id: AgentId) -> Self {
        let (name, description, mission, capabilities) = match kind {
            AgentProfileKindV1::Coding => (
                "Coding Agent",
                "A local software engineering agent.",
                "Inspect a workspace, make approved changes, and verify the requested development task.",
                vec!["workspace.read", "workspace.write", "process.execute"],
            ),
            AgentProfileKindV1::Research => (
                "Research Agent",
                "A research and synthesis agent.",
                "Gather approved evidence and return a concise, sourced answer.",
                vec!["knowledge.read", "documents.read"],
            ),
            AgentProfileKindV1::Operations => (
                "Operations Agent",
                "A governed business operations agent.",
                "Complete approved operational workflows and report every external effect.",
                vec!["operations.read", "operations.write"],
            ),
            AgentProfileKindV1::Custom => (
                "Custom Agent",
                "A user-defined Knolo agent.",
                "Complete the user-defined mission within the declared authority.",
                vec!["state.read"],
            ),
        };
        Self {
            version: 1,
            id,
            name: name.into(),
            description: description.into(),
            kind: kind.clone(),
            mission: mission.into(),
            capabilities: capabilities.into_iter().map(str::to_owned).collect(),
            model: None,
            autonomy: AutonomyLimitsV1::default(),
            operating_style: "careful, explicit, and outcome-focused".into(),
            owner: None,
            lifecycle: Some(AgentLifecycleV1::Active),
            success_criteria: vec!["return a structured result and unresolved issues".into()],
            memory_scopes: match kind {
                AgentProfileKindV1::Coding => vec![MemoryScopeV1::read(
                    NamespaceId::new("agent/coding").expect("static namespace"),
                    16,
                    32 * 1024,
                )],
                AgentProfileKindV1::Research => vec![MemoryScopeV1::read(
                    NamespaceId::new("agent/research").expect("static namespace"),
                    16,
                    32 * 1024,
                )],
                AgentProfileKindV1::Operations => vec![MemoryScopeV1::read(
                    NamespaceId::new("agent/operations").expect("static namespace"),
                    16,
                    32 * 1024,
                )],
                AgentProfileKindV1::Custom => Vec::new(),
            },
        }
    }
}
