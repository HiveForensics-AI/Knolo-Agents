use knolo_agent_core::{
    handoff::{AuthorityV1, DelegationRequestV1, HandoffEnvelopeV1},
    AgentId, ExecutionId, GraphId,
};
use std::collections::{BTreeMap, BTreeSet};

fn id<T: std::str::FromStr>(value: &str) -> T
where
    T::Err: std::fmt::Debug,
{
    value.parse().unwrap()
}

#[test]
fn delegation_requires_narrowed_authority_and_distinct_runs() {
    let parent = AuthorityV1 {
        capabilities: BTreeSet::from(["workspace.read".into()]),
        namespaces: BTreeSet::from(["project".into()]),
        max_steps: 10,
        max_cost_micros: 100,
    };
    let envelope = HandoffEnvelopeV1 {
        version: 1,
        destination: id::<GraphId>("specialist"),
        state_projection: BTreeMap::new(),
        authority_projection: parent.clone(),
        return_contract: "result".into(),
    };
    let request = DelegationRequestV1 {
        version: 1,
        parent_run_id: id::<ExecutionId>("parent-run"),
        child_run_id: id::<ExecutionId>("child-run"),
        parent_profile_id: id::<AgentId>("manager"),
        child_profile_id: id::<AgentId>("specialist"),
        task: "inspect".into(),
        deadline_ms: 1000,
        envelope,
    };
    request.validate(&parent, &parent).unwrap();

    let mut escalated = request.clone();
    escalated.envelope.authority_projection.max_steps = 11;
    assert!(escalated.validate(&parent, &parent).is_err());
}
