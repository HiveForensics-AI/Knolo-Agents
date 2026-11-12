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
fn spawn_float_roots_match_json_stringify() {
    // Roots are SHA-256 of JSON.stringify(value) from Node. The JSON text on
    // the left is intentionally not in that canonical form.
    let cases = [
        (
            "0.000001",
            "output:159fb29a827ad04b260aa6c8ab6d8637f8f2b38af5c4f3cb49d6a21205e040f8",
        ),
        (
            "1e-6",
            "output:159fb29a827ad04b260aa6c8ab6d8637f8f2b38af5c4f3cb49d6a21205e040f8",
        ),
        (
            "1e-7",
            "output:5b33e02f2c5103a05d32f6ba9cb058294452bfbf393967f68bb30c1bdcbbab22",
        ),
        (
            "1e20",
            "output:c344e9487bfbd5c4e03c9fb90d62a5dde5e00b54d55c46e9f4a803aea162b80c",
        ),
        (
            "1e21",
            "output:241c4643fa70b1dcde1205b71be4e3bebb17e9f880c8e1a33d0ead6c27271d3c",
        ),
        (
            "10.0",
            "output:4a44dc15364204a80fe80e9039455cc1608281820fe2b24f1e5233ade6af1dd5",
        ),
        (
            "-0",
            "output:5feceb66ffc86f38d952786c6d696c79c2dbc239dd4e91b46729d73a27fb57e9",
        ),
        (
            "123456789.12345679",
            "output:773807b45c9a120b28c7173e360024cce99d0608d4c5d8f25b9e954d9f1c7ba4",
        ),
        (
            r#"{"score":1e-6,"ok":true,"nested":{"z":1e21,"a":1e-7}}"#,
            "output:d6fbcb33becc4bfe65aa2f85a785dedcea5bb789d015a4c4896dc87d2fd6ebfd",
        ),
    ];
    for (output, root) in cases {
        let receipt = format!(
            r#"{{
              "version": 1,
              "envelopeRoot": "spawn:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
              "outputRoot": "{root}",
              "evaluation": {{"status":"succeeded","successCriteriaMatched":[],"prohibitedViolations":[]}},
              "skillSelectionReceipt": null,
              "evidenceReceipts": [],
              "knowledgeStateRoots": [],
              "finalStatus": "succeeded",
              "output": {output}
            }}"#
        );
        SpawnReceiptV1::parse(&receipt).unwrap_or_else(|error| {
            panic!("output {output} did not match JSON.stringify root {root}: {error:?}")
        });
    }
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
