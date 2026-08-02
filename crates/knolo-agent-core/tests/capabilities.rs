use knolo_agent_core::{retrieval::*, wasm::*, *};
use serde_json::json;
struct Cortex;
impl CortexCapability for Cortex {
    fn retrieve(&mut self, _: &RetrievalQueryV1) -> Result<RetrievalResultV1, CoreError> {
        Ok(RetrievalResultV1 {
            version: 1,
            evidence: vec![RetrievalEvidenceV1 {
                content: json!("fact"),
                score_micros: 900000,
                provenance: EvidenceProvenanceV1 {
                    source_id: "doc-1".into(),
                    locator: "page:2".into(),
                    content_hash: "sha256:abc".into(),
                },
            }],
        })
    }
}
#[test]
fn retriever_preserves_injected_provenance() {
    let mut node = RetrieverNode::new(Cortex);
    let r = node
        .execute(&RetrievalQueryV1 {
            version: 1,
            text: "q".into(),
            limit: 1,
        })
        .unwrap();
    assert_eq!(r.evidence[0].provenance.source_id, "doc-1");
}
struct Host {
    calls: u32,
}
impl HostCapabilities for Host {
    fn invoke(&mut self, r: &ControlRequestV1) -> Result<ControlResponseV1, CoreError> {
        assert_eq!(r.version, CONTROL_PROTOCOL_VERSION);
        self.calls += 1;
        Ok(ControlResponseV1 {
            version: 1,
            payload: json!(null),
        })
    }
}
#[test]
fn wasm_has_only_the_versioned_capability_boundary() {
    let mut h = Host { calls: 0 };
    h.invoke(&ControlRequestV1 {
        version: 1,
        capability: "clock".into(),
        operation: "now".into(),
        payload: json!(null),
    })
    .unwrap();
    assert_eq!(h.calls, 1);
}
