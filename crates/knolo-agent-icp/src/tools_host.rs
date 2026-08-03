//! Pack-gated in-canister tools for the ICP host.
use knolo_agent::host::ToolRegistry;
use knolo_agent::policy::BudgetLedger;
use knolo_agent::tool::ToolImplementation;
use knolo_agent_core::{
    pack::CompiledPolicyV1,
    tool::{ResourceBudgetV1, ResourceUsageV1, ToolCallV1, ToolDefinition, ToolResultV1},
    CapabilityId, CoreError, NamespaceId, ToolId,
};
use serde_json::{json, Value};
use std::str::FromStr;

/// Built-in echo tool (deterministic; no network).
pub struct EchoTool {
    def: ToolDefinition,
}

impl EchoTool {
    pub fn new() -> Self {
        Self {
            def: ToolDefinition {
                version: 1,
                id: ToolId::from_str("echo").unwrap(),
                namespace: NamespaceId::from_str("tools").unwrap(),
                capability: CapabilityId::from_str("echo").unwrap(),
                argument_contract: json!({
                    "type": "object",
                    "properties": { "message": { "type": "string" } },
                    "required": ["message"]
                }),
                result_contract: json!({
                    "type": "object",
                    "properties": { "echo": { "type": "string" } },
                    "required": ["echo"]
                }),
            },
        }
    }
}

impl Default for EchoTool {
    fn default() -> Self {
        Self::new()
    }
}

impl ToolImplementation for EchoTool {
    fn definition(&self) -> &ToolDefinition {
        &self.def
    }
    fn execute(&mut self, arguments: &Value) -> Result<(Value, ResourceUsageV1), CoreError> {
        let message = arguments
            .get("message")
            .and_then(Value::as_str)
            .unwrap_or("");
        Ok((
            json!({ "echo": message }),
            ResourceUsageV1 {
                calls: 1,
                units: 1,
                duration_ms: 0,
            },
        ))
    }
}

/// HTTPS tool placeholder — fails closed unless host allows and URL is present.
/// Real outcalls are performed by the canister layer when configured.
pub struct HttpsGetTool {
    def: ToolDefinition,
    pub allow: bool,
    /// Injected response for tests / after outcall.
    pub canned: Option<String>,
}

impl HttpsGetTool {
    pub fn new(allow: bool) -> Self {
        Self {
            def: ToolDefinition {
                version: 1,
                id: ToolId::from_str("https_get").unwrap(),
                namespace: NamespaceId::from_str("tools").unwrap(),
                capability: CapabilityId::from_str("https").unwrap(),
                argument_contract: json!({
                    "type": "object",
                    "properties": { "url": { "type": "string" } },
                    "required": ["url"]
                }),
                result_contract: json!({
                    "type": "object",
                    "properties": {
                        "status": { "type": "number" },
                        "body": { "type": "string" }
                    },
                    "required": ["status", "body"]
                }),
            },
            allow,
            canned: None,
        }
    }
}

impl ToolImplementation for HttpsGetTool {
    fn definition(&self) -> &ToolDefinition {
        &self.def
    }
    fn execute(&mut self, arguments: &Value) -> Result<(Value, ResourceUsageV1), CoreError> {
        if !self.allow {
            return Err(CoreError::Host(
                "https_get disabled by host config (allow_https_tools=false)".into(),
            ));
        }
        let url = arguments.get("url").and_then(Value::as_str).unwrap_or("");
        if url.is_empty() {
            return Err(CoreError::Host("https_get requires url".into()));
        }
        if let Some(body) = &self.canned {
            return Ok((
                json!({ "status": 200, "body": body }),
                ResourceUsageV1 {
                    calls: 1,
                    units: 10,
                    duration_ms: 1,
                },
            ));
        }
        // Canister layer should fulfill via outcall before execute; without body, fail closed.
        Err(CoreError::Host(format!(
            "https_get for '{url}' has no outcall result; inject body or use mock"
        )))
    }
}

pub fn default_registry(allow_https: bool) -> ToolRegistry {
    let mut reg = ToolRegistry::default();
    let _ = reg.register(EchoTool::new());
    let _ = reg.register(HttpsGetTool::new(allow_https));
    reg
}

pub fn execute_tool_call(
    registry: &mut ToolRegistry,
    policy: Option<&CompiledPolicyV1>,
    ledger: &mut BudgetLedger,
    tool_id: &str,
    arguments: Value,
    call_id: &str,
) -> Result<ToolResultV1, CoreError> {
    let policy = policy.ok_or_else(|| {
        CoreError::Host("tool execution requires a pack policy on the definition".into())
    })?;
    let call = ToolCallV1 {
        version: 1,
        call_id: call_id.into(),
        tool_id: ToolId::from_str(tool_id)
            .map_err(|e| CoreError::Host(format!("invalid tool_id: {e}")))?,
        arguments,
    };
    let mut audit = Vec::new();
    registry.execute(policy, ledger, call, &mut audit)
}

/// Minimal open pack granting echo (+ optional https).
pub fn permissive_tools_pack(include_https: bool) -> knolo_agent_core::pack::PackDeclarationV1 {
    use knolo_agent_core::pack::PackDeclarationV1;
    use std::collections::{BTreeMap, BTreeSet};
    let mut tools = BTreeSet::from([ToolId::from_str("echo").unwrap()]);
    let mut bindings = BTreeMap::from([(
        CapabilityId::from_str("echo").unwrap(),
        "builtin:echo".into(),
    )]);
    if include_https {
        tools.insert(ToolId::from_str("https_get").unwrap());
        bindings.insert(
            CapabilityId::from_str("https").unwrap(),
            "builtin:https".into(),
        );
    }
    PackDeclarationV1 {
        version: 1,
        id: knolo_agent_core::PackId::from_str("icp-host-pack").unwrap(),
        tools,
        namespaces: BTreeSet::from([NamespaceId::from_str("tools").unwrap()]),
        argument_constraints: BTreeMap::new(),
        budget: ResourceBudgetV1 {
            max_calls: 32,
            max_units: 10_000,
            max_duration_ms: 60_000,
        },
        capability_bindings: bindings,
    }
}
