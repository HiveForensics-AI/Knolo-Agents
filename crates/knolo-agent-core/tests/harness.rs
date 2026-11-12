use knolo_agent_core::{
    compute_harness_dependency_root, HarnessDependencyRootV1, HarnessRunReceiptV1,
    SpawnAuthorityV1, SpawnEnvelopeV1, SpawnReceiptV1, TaskV1,
};

#[test]
fn dummy_task_fixture_parses_and_validates() {
    let fixture = include_str!("../../../contracts/fixtures/harness/task-dummy-v1.json");
    let task = TaskV1::parse(fixture).unwrap();
    assert_eq!(task.id.as_deref(), Some("dummy-investigate"));
    assert_eq!(task.success_criteria.len(), 3);
    assert_eq!(task.budget.as_ref().unwrap().max_steps, Some(8));
}

#[test]
fn empty_objective_fails_closed() {
    let err = TaskV1::parse(
        r#"{"objective":" ","successCriteria":["identify suspicious transactions"]}"#,
    )
    .unwrap_err();
    assert!(format!("{err:?}").contains("objective"));
}

#[test]
fn golden_dependency_root_matches_typescript_digest() {
    let fixture = include_str!("../../../contracts/fixtures/harness/dependency-root-v1.json");
    let golden = HarnessDependencyRootV1::parse(fixture).unwrap();
    let computed = compute_harness_dependency_root(&golden.dependencies).unwrap();
    assert_eq!(computed.root, golden.root);
    assert_eq!(computed.algorithm, "knolo.harness.dependencies.v1");
    assert_eq!(computed.dependencies.len(), 2);
}

#[test]
fn reversed_dependencies_yield_the_same_root() {
    let fixture = include_str!("../../../contracts/fixtures/harness/dependency-root-v1.json");
    let golden = HarnessDependencyRootV1::parse(fixture).unwrap();
    let mut reversed = golden.dependencies.clone();
    reversed.reverse();
    let computed = compute_harness_dependency_root(&reversed).unwrap();
    assert_eq!(computed.root, golden.root);
}

#[test]
fn harness_run_receipt_fixture_parses() {
    let fixture = include_str!("../../../contracts/fixtures/harness/run-receipt-v1.json");
    let receipt = HarnessRunReceiptV1::parse(fixture).unwrap();
    assert_eq!(receipt.version, 1);
    assert_eq!(receipt.run_id, "dummy-run");
    assert!(receipt.skill_selection_receipt.is_none());
    assert_eq!(receipt.evaluation_receipt.success_criteria_matched.len(), 1);
}

#[test]
fn spawn_envelope_fixture_round_trips_and_rejects_escalation() {
    let fixture = include_str!("../../../contracts/fixtures/harness/spawn-envelope-v1.json");
    let envelope = SpawnEnvelopeV1::parse(fixture).unwrap();
    assert_eq!(envelope.version, 1);
    assert_eq!(envelope.parent.id, "parent");
    assert_eq!(envelope.return_contract, "spawn.return.v1");
    let parent = SpawnAuthorityV1 {
        capabilities: vec!["ledger.read".into()],
        tools: vec![],
        namespaces: vec!["examples.ledger".into()],
        max_steps: 8,
        max_cost_micros: 1000,
    };
    let pack = SpawnAuthorityV1 {
        capabilities: vec!["ledger.read".into(), "payments.send".into()],
        tools: vec!["search_ledger".into()],
        namespaces: vec!["examples.ledger".into(), "examples.payments".into()],
        max_steps: 16,
        max_cost_micros: 5000,
    };
    envelope.validate(&parent, &pack).unwrap();

    let mut widened = envelope.clone();
    widened.authority.capabilities.push("payments.send".into());
    let capability = widened.validate(&parent, &pack).unwrap_err();
    assert!(format!("{capability:?}").contains("AuthorityEscalation"));

    let mut namespace = envelope.clone();
    namespace
        .authority
        .namespaces
        .push("examples.payments".into());
    assert!(
        format!("{:?}", namespace.validate(&parent, &pack).unwrap_err())
            .contains("AuthorityEscalation")
    );

    let mut steps = envelope.clone();
    steps.authority.max_steps = 9;
    assert!(format!("{:?}", steps.validate(&parent, &pack).unwrap_err())
        .contains("AuthorityEscalation"));

    let mut cost = envelope.clone();
    cost.authority.max_cost_micros = 1001;
    assert!(
        format!("{:?}", cost.validate(&parent, &pack).unwrap_err()).contains("AuthorityEscalation")
    );

    let mut tampered: serde_json::Value = serde_json::from_str(fixture).unwrap();
    tampered["envelopeRoot"] = serde_json::Value::String(format!("spawn:{}", "0".repeat(64)));
    let err = SpawnEnvelopeV1::parse(&tampered.to_string()).unwrap_err();
    assert!(format!("{err:?}").contains("root mismatch"));
}

#[test]
fn spawn_receipt_fixture_binds_the_envelope() {
    let envelope = SpawnEnvelopeV1::parse(include_str!(
        "../../../contracts/fixtures/harness/spawn-envelope-v1.json"
    ))
    .unwrap();
    let receipt = SpawnReceiptV1::parse(include_str!(
        "../../../contracts/fixtures/harness/spawn-receipt-v1.json"
    ))
    .unwrap();
    assert_eq!(receipt.version, 1);
    assert_eq!(receipt.envelope_root, envelope.envelope_root);
    assert_eq!(
        receipt.final_status,
        knolo_agent_core::InvocationStatusV1::Succeeded
    );
    assert_eq!(receipt.evaluation.success_criteria_matched.len(), 3);
}

#[test]
fn unknown_receipt_version_fails_closed() {
    let err = HarnessRunReceiptV1::parse(
        r#"{
          "version": 2,
          "runId": "x",
          "agentDescriptorHash": "agent:aa",
          "taskRoot": "task:aa",
          "inputRoot": "input:aa",
          "knowledgeStateRoots": [],
          "harnessDependencyRoot": "knolo.harness.dependencies.v1:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
          "authorityRoot": "authority:aa",
          "skillSelectionReceipt": null,
          "evidenceReceipts": [],
          "toolReceipts": [],
          "evaluationReceipt": {"status":"succeeded","successCriteriaMatched":[],"prohibitedViolations":[]},
          "recoveryEvents": [],
          "finalStatus": "succeeded",
          "output": "ok"
        }"#,
    )
    .unwrap_err();
    assert!(format!("{err:?}").contains("version"));
}
