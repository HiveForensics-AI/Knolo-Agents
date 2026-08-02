//! End-to-end host-bound capabilities. Run with `cargo run -p knolo-agent --example complete`.
use knolo_agent::{
    claims::{commit_proposal, ClaimGraphCapability, ClaimProposalV1, MutationApprovalV1},
    cortex::{CortexCapability, CortexContextNode},
    multi_agent::{AuthorityV1, HandoffEnvelopeV1},
    replay::{ArtifactHashesV1, ReplayModeV1, ReplayRequestV1},
    CoreError, GraphId,
};
use serde_json::{json, Value};
use std::collections::BTreeSet;

struct CoreBoundary;
impl CortexCapability for CoreBoundary {
    fn query(&mut self, request: &Value) -> Result<Value, CoreError> {
        Ok(request.clone())
    }
    fn context(&mut self, _: &Value) -> Result<Value, CoreError> {
        Ok(json!({"evidence": [{"source": "local"}]}))
    }
}
impl ClaimGraphCapability for CoreBoundary {
    fn read(&mut self, query: &Value) -> Result<Value, CoreError> {
        Ok(query.clone())
    }
    fn commit(&mut self, proposal: &ClaimProposalV1) -> Result<Value, CoreError> {
        Ok(proposal.operation.clone())
    }
}
fn main() -> Result<(), CoreError> {
    let context = CortexContextNode::new(CoreBoundary).execute(&json!({"query": "Knolo"}))?;
    let mut claims = CoreBoundary;
    let committed = commit_proposal(
        &mut claims,
        &ClaimProposalV1 {
            operation: json!({"add": "claim"}),
            justification: "local evidence".into(),
        },
        &MutationApprovalV1::Human {
            reviewer: "reviewer@example.test".into(),
        },
    )?;
    let authority = AuthorityV1 {
        capabilities: BTreeSet::from(["claims.read".into()]),
        namespaces: BTreeSet::from(["local".into()]),
        max_steps: 2,
        max_cost_micros: 10,
    };
    let handoff = HandoffEnvelopeV1 {
        version: 1,
        destination: GraphId::new("reviewer")?,
        state_projection: [(("claim").into(), ("claim").into())].into(),
        authority_projection: authority,
        return_contract: "review-v1".into(),
    };
    let replay = ReplayRequestV1 {
        version: 1,
        mode: ReplayModeV1::MockedEffects,
        artifacts: ArtifactHashesV1 {
            graph: "graph".into(),
            pack: "pack".into(),
            policy: "policy".into(),
            node_implementation: "nodes".into(),
            contract: "v1".into(),
        },
        live_effect_authorization: None,
    };
    println!(
        "{}",
        json!({"context": context, "committed": committed, "handoff": handoff, "replay": replay})
    );
    Ok(())
}
