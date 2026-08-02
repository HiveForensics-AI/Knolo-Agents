use crate::{
    policy::{authorize, deny, validate_call, validate_schema, BudgetLedger},
    tool::ToolImplementation,
};
use knolo_agent_core::{
    pack::CompiledPolicyV1,
    policy::PolicyDenialCodeV1 as Code,
    tool::{ToolCallV1, ToolResultV1},
    CoreError, ToolId,
};
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ToolAuditEventV1 {
    pub version: u16,
    pub sequence: u64,
    pub call_id: String,
    pub tool_id: ToolId,
    pub outcome: String,
}
pub trait ToolAuditSink {
    fn emit(&mut self, event: &ToolAuditEventV1) -> Result<(), CoreError>;
}
impl ToolAuditSink for Vec<ToolAuditEventV1> {
    fn emit(&mut self, e: &ToolAuditEventV1) -> Result<(), CoreError> {
        self.push(e.clone());
        Ok(())
    }
}
#[derive(Default)]
pub struct ToolRegistry {
    tools: BTreeMap<ToolId, Box<dyn ToolImplementation>>,
}
impl ToolRegistry {
    pub fn register(&mut self, tool: impl ToolImplementation + 'static) -> Result<(), CoreError> {
        let id = tool.definition().id.clone();
        if self.tools.insert(id, Box::new(tool)).is_some() {
            return Err(CoreError::Host("duplicate tool".into()));
        }
        Ok(())
    }
    pub fn execute(
        &mut self,
        policy: &CompiledPolicyV1,
        ledger: &mut BudgetLedger,
        call: ToolCallV1,
        audit: &mut dyn ToolAuditSink,
    ) -> Result<ToolResultV1, CoreError> {
        let outcome = (|| {
            validate_call(&call)?;
            let tool = self.tools.get_mut(&call.tool_id).ok_or_else(|| {
                CoreError::PolicyDenied(knolo_agent_core::policy::PolicyDenialV1 {
                    version: 1,
                    code: Code::ToolNotFound,
                    tool_id: Some(call.tool_id.clone()),
                    namespace: None,
                    message: "tool is not registered".into(),
                })
            })?;
            let def = tool.definition().clone();
            authorize(policy, &def, &call)?;
            ledger.reserve_call(policy, &def)?;
            let (value, usage) = tool.execute(&call.arguments)?;
            ledger.charge(policy, &def, &usage)?;
            if !validate_schema(&value, &def.result_contract) {
                return Err(deny(
                    Code::ResultInvalid,
                    Some(&def),
                    "tool result violates contract",
                ));
            }
            Ok(ToolResultV1 {
                version: 1,
                call_id: call.call_id.clone(),
                tool_id: call.tool_id.clone(),
                value,
                usage,
            })
        })();
        let status = if outcome.is_ok() {
            "executed"
        } else {
            "denied"
        };
        audit.emit(&ToolAuditEventV1 {
            version: 1,
            sequence: 0,
            call_id: call.call_id,
            tool_id: call.tool_id,
            outcome: status.into(),
        })?;
        outcome
    }
}
