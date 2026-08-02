use knolo_agent_core::{
    pack::CompiledPolicyV1,
    policy::PolicyDenialCodeV1 as Code,
    tool::{ResourceUsageV1, ToolCallV1, ToolDefinition},
    CoreError,
};
use serde_json::Value;

pub use knolo_agent_core::policy::{PolicyDenialCodeV1, PolicyDenialV1};

#[derive(Debug, Clone)]
pub struct BudgetLedger {
    used: ResourceUsageV1,
}
impl Default for BudgetLedger {
    fn default() -> Self {
        Self {
            used: ResourceUsageV1::default(),
        }
    }
}
impl BudgetLedger {
    pub fn reserve_call(
        &mut self,
        policy: &CompiledPolicyV1,
        tool: &ToolDefinition,
    ) -> Result<(), CoreError> {
        if self.used.calls >= policy.budget().max_calls {
            return Err(deny(
                Code::BudgetExhausted,
                Some(tool),
                "call budget exhausted",
            ));
        }
        self.used.calls += 1;
        Ok(())
    }
    pub fn charge(
        &mut self,
        policy: &CompiledPolicyV1,
        tool: &ToolDefinition,
        usage: &ResourceUsageV1,
    ) -> Result<(), CoreError> {
        self.used.units = self.used.units.saturating_add(usage.units);
        self.used.duration_ms = self.used.duration_ms.saturating_add(usage.duration_ms);
        if self.used.units > policy.budget().max_units
            || self.used.duration_ms > policy.budget().max_duration_ms
        {
            return Err(deny(
                Code::BudgetExhausted,
                Some(tool),
                "execution budget exhausted",
            ));
        }
        Ok(())
    }
}
pub fn validate_call(call: &ToolCallV1) -> Result<(), CoreError> {
    if call.version != 1 || call.call_id.is_empty() || !call.arguments.is_object() {
        Err(deny(Code::InvalidContract, None, "invalid ToolCallV1"))
    } else {
        Ok(())
    }
}
pub fn validate_schema(value: &Value, schema: &Value) -> bool {
    let Some(s) = schema.as_object() else {
        return false;
    };
    if let Some(t) = s.get("type").and_then(Value::as_str) {
        let ok = match t {
            "object" => value.is_object(),
            "array" => value.is_array(),
            "string" => value.is_string(),
            "number" => value.is_number(),
            "boolean" => value.is_boolean(),
            "null" => value.is_null(),
            _ => false,
        };
        if !ok {
            return false;
        }
    }
    if let Some(required) = s.get("required").and_then(Value::as_array) {
        if required
            .iter()
            .any(|k| k.as_str().and_then(|k| value.get(k)).is_none())
        {
            return false;
        }
    }
    if let (Some(props), Some(obj)) = (
        s.get("properties").and_then(Value::as_object),
        value.as_object(),
    ) {
        for (k, sub) in props {
            if let Some(v) = obj.get(k) {
                if !validate_schema(v, sub) {
                    return false;
                }
            }
        }
    }
    if let Some(c) = s.get("const") {
        if value != c {
            return false;
        }
    }
    if let (Some(max), Some(n)) = (s.get("maximum").and_then(Value::as_f64), value.as_f64()) {
        if n > max {
            return false;
        }
    }
    true
}
pub fn deny(code: Code, tool: Option<&ToolDefinition>, message: &str) -> CoreError {
    CoreError::PolicyDenied(PolicyDenialV1 {
        version: 1,
        code,
        tool_id: tool.map(|t| t.id.clone()),
        namespace: tool.map(|t| t.namespace.clone()),
        message: message.into(),
    })
}
pub fn authorize(
    policy: &CompiledPolicyV1,
    tool: &ToolDefinition,
    call: &ToolCallV1,
) -> Result<(), CoreError> {
    if !policy.allows_tool(&tool.id) {
        return Err(deny(
            Code::ToolNotAllowed,
            Some(tool),
            "tool is not granted by pack",
        ));
    }
    if !policy.allows_namespace(&tool.namespace) {
        return Err(deny(
            Code::NamespaceDenied,
            Some(tool),
            "namespace is not granted by pack",
        ));
    }
    if policy.binding(&tool.capability).is_none() {
        return Err(deny(
            Code::CapabilityUnavailable,
            Some(tool),
            "capability is not bound",
        ));
    }
    if !validate_schema(&call.arguments, &tool.argument_contract)
        || policy
            .constraint(&tool.id)
            .is_some_and(|s| !validate_schema(&call.arguments, s))
    {
        return Err(deny(
            Code::ArgumentDenied,
            Some(tool),
            "arguments violate policy",
        ));
    }
    Ok(())
}
