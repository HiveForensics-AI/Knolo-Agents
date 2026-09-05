use knolo_agent_core::{
    compute_harness_dependency_root, HarnessDependencyRootV1, HarnessRunReceiptV1, TaskV1,
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
