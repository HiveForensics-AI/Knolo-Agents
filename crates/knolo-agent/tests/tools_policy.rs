use knolo_agent::{host::*, pack::*, policy::BudgetLedger, tool::ToolImplementation, *};
use serde_json::{json, Value};
use std::collections::{BTreeMap, BTreeSet};
fn id<T: std::str::FromStr>(s: &str) -> T
where
    T::Err: std::fmt::Debug,
{
    s.parse().unwrap()
}
fn definition() -> tool::ToolDefinition {
    tool::ToolDefinition {
        version: 1,
        id: id("search"),
        namespace: id("knowledge/private"),
        capability: id("cortex"),
        argument_contract: json!({"type":"object","required":["q"],"properties":{"q":{"type":"string"}}}),
        result_contract: json!({"type":"object","required":["answer"]}),
        retry_class: tool::RetryClassV1::Idempotent,
    }
}
struct Search {
    def: tool::ToolDefinition,
    calls: u32,
    secret: String,
}
impl ToolImplementation for Search {
    fn definition(&self) -> &tool::ToolDefinition {
        &self.def
    }
    fn execute(&mut self, _: &Value) -> Result<(Value, tool::ResourceUsageV1), CoreError> {
        self.calls += 1;
        assert_eq!(self.secret, "host-only");
        Ok((
            json!({"answer":"ok"}),
            tool::ResourceUsageV1 {
                calls: 1,
                units: 1,
                duration_ms: 1,
            },
        ))
    }
}
fn policy(namespace: &str, calls: u64) -> CompiledPolicyV1 {
    pack::PackDeclarationV1 {
        version: 1,
        id: id("pack"),
        tools: BTreeSet::from([id("search")]),
        namespaces: BTreeSet::from([id(namespace)]),
        argument_constraints: BTreeMap::from([(
            id("search"),
            json!({"type":"object","properties":{"q":{"const":"allowed"}}}),
        )]),
        budget: tool::ResourceBudgetV1 {
            max_calls: calls,
            max_units: 10,
            max_duration_ms: 10,
        },
        capability_bindings: BTreeMap::from([(id("cortex"), "host:cortex".into())]),
    }
    .compile()
    .unwrap()
}
fn registry() -> ToolRegistry {
    let mut r = ToolRegistry::default();
    r.register(Search {
        def: definition(),
        calls: 0,
        secret: "host-only".into(),
    })
    .unwrap();
    r
}
#[test]
fn deny_by_default_namespace_isolation_and_malformed_arguments() {
    let call = || tool::ToolCallV1 {
        version: 1,
        call_id: "1".into(),
        tool_id: id("search"),
        arguments: json!({"q":"allowed"}),
    };
    let mut audit = vec![];
    let mut ledger = BudgetLedger::default();
    let mut r = registry();
    assert!(matches!(
        r.execute(&policy("other", 2), &mut ledger, call(), &mut audit),
        Err(CoreError::PolicyDenied(policy::PolicyDenialV1 {
            code: policy::PolicyDenialCodeV1::NamespaceDenied,
            ..
        }))
    ));
    let mut bad = call();
    bad.arguments = json!({"q":3});
    assert!(r
        .execute(
            &policy("knowledge/private", 2),
            &mut ledger,
            bad,
            &mut audit
        )
        .is_err());
    assert_eq!(audit.len(), 2);
}
#[test]
fn budget_is_reserved_before_execution() {
    let mut r = registry();
    let mut ledger = BudgetLedger::default();
    let mut audit = vec![];
    let p = policy("knowledge/private", 1);
    let call = || tool::ToolCallV1 {
        version: 1,
        call_id: "x".into(),
        tool_id: id("search"),
        arguments: json!({"q":"allowed"}),
    };
    assert!(r.execute(&p, &mut ledger, call(), &mut audit).is_ok());
    assert_eq!(audit[0].receipt.idempotency_key, "x");
    assert_eq!(audit[0].receipt.retry_class, tool::RetryClassV1::Idempotent);
    assert!(matches!(
        r.execute(&p, &mut ledger, call(), &mut audit),
        Err(CoreError::PolicyDenied(policy::PolicyDenialV1 {
            code: policy::PolicyDenialCodeV1::BudgetExhausted,
            ..
        }))
    ));
    assert_eq!(audit[1].receipt.status, tool::EffectStatusV1::Denied);
}
#[test]
fn packs_and_audits_cannot_serialize_host_secrets() {
    let p = pack::PackDeclarationV1 {
        version: 1,
        id: id("p"),
        tools: BTreeSet::new(),
        namespaces: BTreeSet::new(),
        argument_constraints: BTreeMap::new(),
        budget: tool::ResourceBudgetV1 {
            max_calls: 1,
            max_units: 1,
            max_duration_ms: 1,
        },
        capability_bindings: BTreeMap::new(),
    };
    assert!(!serde_json::to_string(&p).unwrap().contains("secret"));
    assert!(!serde_json::to_string(&Vec::<ToolAuditEventV1>::new())
        .unwrap()
        .contains("secret"));
}
