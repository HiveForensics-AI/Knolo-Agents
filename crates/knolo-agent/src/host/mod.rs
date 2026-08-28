use crate::{
    policy::{authorize, deny, validate_call, validate_schema, BudgetLedger},
    tool::ToolImplementation,
};
use knolo_agent_core::{
    pack::CompiledPolicyV1,
    policy::PolicyDenialCodeV1 as Code,
    tool::{EffectReceiptV1, EffectStatusV1, RetryClassV1, ToolCallV1, ToolResultV1},
    CoreError, ToolId,
};
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ToolAuditEventV1 {
    pub version: u16,
    pub sequence: u64,
    pub call_id: String,
    pub tool_id: ToolId,
    pub outcome: String,
    pub receipt: EffectReceiptV1,
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
    audit_sequence: u64,
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
        let receipt_call_id = call.call_id.clone();
        let receipt_tool_id = call.tool_id.clone();
        let retry_class = self
            .tools
            .get(&call.tool_id)
            .map(|tool| tool.definition().retry_class.clone())
            .unwrap_or(RetryClassV1::NonIdempotent);
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
                usage: usage.clone(),
                receipt: EffectReceiptV1 {
                    version: 1,
                    call_id: call.call_id.clone(),
                    tool_id: call.tool_id.clone(),
                    host: "knolo-agent-host".into(),
                    idempotency_key: call.call_id.clone(),
                    status: EffectStatusV1::Executed,
                    redacted_output: serde_json::Value::Null,
                    resource_delta: usage.clone(),
                    retry_class: retry_class.clone(),
                },
            })
        })();
        let receipt = outcome
            .as_ref()
            .map(|result| result.receipt.clone())
            .unwrap_or_else(|error| EffectReceiptV1 {
                version: 1,
                call_id: receipt_call_id.clone(),
                tool_id: receipt_tool_id.clone(),
                host: "knolo-agent-host".into(),
                idempotency_key: receipt_call_id.clone(),
                status: if matches!(error, CoreError::PolicyDenied(_)) {
                    EffectStatusV1::Denied
                } else {
                    EffectStatusV1::Failed
                },
                redacted_output: serde_json::Value::Null,
                resource_delta: Default::default(),
                retry_class: retry_class.clone(),
            });
        let status = match receipt.status {
            EffectStatusV1::Executed => "executed",
            EffectStatusV1::Denied => "denied",
            EffectStatusV1::Failed => "failed",
        };
        self.audit_sequence += 1;
        audit.emit(&ToolAuditEventV1 {
            version: 1,
            sequence: self.audit_sequence,
            call_id: receipt_call_id,
            tool_id: receipt_tool_id,
            outcome: status.into(),
            receipt,
        })?;
        outcome
    }
}
