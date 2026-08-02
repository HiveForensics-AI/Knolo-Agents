use knolo_agent::{
    checkpoint::CheckpointV1,
    checkpoint::FilesystemCheckpointStore,
    claims::{commit_proposal, ClaimGraphCapability, ClaimProposalV1, MutationApprovalV1},
    handoff::{AuthorityV1, HandoffEnvelopeV1},
    hitl::SuspensionV1,
    node::CheckpointStore,
    redaction::RedactionRulesV1,
    replay::{ArtifactHashesV1, ReplayModeV1, ReplayRequestV1},
    ExecutionId, GraphId, NodeId, StateSchemaId,
};
use serde_json::{json, Value};
use std::collections::{BTreeMap, BTreeSet};

fn authority(caps: &[&str], steps: u64) -> AuthorityV1 {
    AuthorityV1 {
        capabilities: caps.iter().map(|x| x.to_string()).collect(),
        namespaces: BTreeSet::from(["claims".into()]),
        max_steps: steps,
        max_cost_micros: 100,
    }
}
fn hashes() -> ArtifactHashesV1 {
    ArtifactHashesV1 {
        graph: "g".into(),
        pack: "p".into(),
        policy: "y".into(),
        node_implementation: "n".into(),
        contract: "c".into(),
    }
}

#[test]
fn nested_handoff_is_inspectable_and_narrows_authority() {
    let parent = authority(&["read", "write"], 10);
    let pack = authority(&["read"], 20);
    let envelope = HandoffEnvelopeV1 {
        version: 1,
        destination: GraphId::new("child/subgraph").unwrap(),
        state_projection: BTreeMap::from([("/task".into(), "/delegated".into())]),
        authority_projection: authority(&["read"], 5),
        return_contract: "claim-result-v1".into(),
    };
    envelope.validate(&parent, &pack).unwrap();
    let mut escalation = envelope;
    escalation
        .authority_projection
        .capabilities
        .insert("write".into());
    assert!(escalation.validate(&parent, &pack).is_err());
}

struct Claims {
    commits: usize,
}
impl ClaimGraphCapability for Claims {
    fn read(&mut self, _: &Value) -> Result<Value, knolo_agent::CoreError> {
        Ok(json!([]))
    }
    fn commit(&mut self, _: &ClaimProposalV1) -> Result<Value, knolo_agent::CoreError> {
        self.commits += 1;
        Ok(json!({"committed": true}))
    }
}
#[test]
fn claim_mutations_are_gated_and_rejection_has_no_effect() {
    let mut core = Claims { commits: 0 };
    let proposal = ClaimProposalV1 {
        operation: json!({"add":"claim"}),
        justification: "evidence".into(),
    };
    assert!(commit_proposal(&mut core, &proposal, &MutationApprovalV1::Rejected).is_err());
    assert_eq!(core.commits, 0);
    commit_proposal(
        &mut core,
        &proposal,
        &MutationApprovalV1::Human {
            reviewer: "alice".into(),
        },
    )
    .unwrap();
    assert_eq!(core.commits, 1);
}

#[test]
fn stale_resume_and_incompatible_or_unsafe_replay_are_rejected() {
    let suspension = SuspensionV1 {
        version: 1,
        execution_id: ExecutionId::new("run").unwrap(),
        reason: "approval".into(),
        requested_action: "approve".into(),
        review_context: json!({"safe":true}),
        expires_at_ms: 10,
        resume_schema_hash: "schema".into(),
        artifact_hashes: hashes(),
        nonce: "once".into(),
    };
    let token = suspension.token().unwrap();
    assert!(suspension
        .validate_resume(&token, 10, "schema", &json!({}))
        .is_err());
    assert!(suspension
        .validate_resume(&token, 1, "wrong", &json!({}))
        .is_err());
    let live = ReplayRequestV1 {
        version: 1,
        mode: ReplayModeV1::LiveEffects,
        artifacts: hashes(),
        live_effect_authorization: None,
    };
    assert!(live.validate(&hashes()).is_err());
    let verify = ReplayRequestV1 {
        version: 1,
        mode: ReplayModeV1::VerifyOnly,
        artifacts: hashes(),
        live_effect_authorization: None,
    };
    assert!(verify.validate(&hashes()).is_ok());
    let mut changed = hashes();
    changed.contract = "changed".into();
    assert!(verify.validate(&changed).is_err());
}

#[test]
fn filesystem_checkpoint_recovers_after_store_reopen_and_redacts_review_data() {
    let root = std::env::temp_dir().join(format!("knolo-checkpoint-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&root);
    let id = ExecutionId::new("crash-recovery").unwrap();
    let cp = CheckpointV1 {
        version: 1,
        execution_id: id.clone(),
        graph_hash: "g".into(),
        pack_hash: "p".into(),
        policy_hash: "y".into(),
        node_implementation_hash: "n".into(),
        contract_hash: "c".into(),
        state: knolo_agent::state::StateSnapshot {
            schema_id: StateSchemaId::new("s").unwrap(),
            revision: 2,
            value: json!({"ok":true}),
            provenance: None,
        },
        pending_node: NodeId::new("next").unwrap(),
        event_cursor: 3,
        steps: 2,
        tokens: 1,
        cost_micros: 0,
    };
    FilesystemCheckpointStore::new(&root)
        .unwrap()
        .save(&cp)
        .unwrap();
    let reopened = FilesystemCheckpointStore::new(&root).unwrap();
    assert_eq!(reopened.load(&id).unwrap(), Some(cp));
    let rules = RedactionRulesV1 {
        version: 1,
        json_pointers: BTreeSet::from([
            "/prompt".into(),
            "/tool/secret".into(),
            "/retrieved".into(),
            "/review/ssn".into(),
        ]),
        replacement: "[REDACTED]".into(),
    };
    let output = rules.apply(
        &json!({"prompt":"p", "tool":{"secret":"x"}, "retrieved":"doc", "review":{"ssn":"1"}}),
    );
    assert_eq!(output.pointer("/review/ssn"), Some(&json!("[REDACTED]")));
    std::fs::remove_dir_all(root).unwrap();
}
