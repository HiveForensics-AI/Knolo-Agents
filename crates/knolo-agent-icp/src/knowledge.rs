//! Inter-canister retrieval against knolo-core knowledge canisters.
use candid::{CandidType, Principal};
use knolo_agent_core::{
    retrieval::{EvidenceProvenanceV1, RetrievalEvidenceV1, RetrievalQueryV1, RetrievalResultV1},
    CoreError,
};
use serde::Deserialize;
use serde_json::json;

/// Mirrors knolo-core `packages/icp-canister` HitDto.
#[derive(CandidType, Deserialize, Clone, Debug, PartialEq)]
pub struct KnowledgeHitDto {
    pub block_id: u64,
    pub score: f64,
    pub text: String,
    pub source: Option<String>,
    pub namespace: Option<String>,
}

#[cfg_attr(not(target_arch = "wasm32"), allow(dead_code))]
pub fn hits_to_retrieval(hits: Vec<KnowledgeHitDto>) -> RetrievalResultV1 {
    RetrievalResultV1 {
        version: 1,
        evidence: hits
            .into_iter()
            .map(|h| RetrievalEvidenceV1 {
                content: json!({
                    "text": h.text,
                    "block_id": h.block_id,
                    "namespace": h.namespace,
                }),
                score_micros: (h.score.clamp(0.0, 1.0) * 1_000_000.0) as u32,
                provenance: EvidenceProvenanceV1 {
                    source_id: h.source.unwrap_or_else(|| "knowledge".into()),
                    locator: format!("block:{}", h.block_id),
                    content_hash: format!("{:016x}", h.block_id),
                },
            })
            .collect(),
    }
}

/// Mock retrieval for unit tests / offline.
pub fn mock_retrieve(query: &RetrievalQueryV1) -> RetrievalResultV1 {
    RetrievalResultV1 {
        version: 1,
        evidence: vec![RetrievalEvidenceV1 {
            content: json!({ "text": format!("mock hit for: {}", query.text) }),
            score_micros: 900_000,
            provenance: EvidenceProvenanceV1 {
                source_id: "mock".into(),
                locator: "mock:0".into(),
                content_hash: "mock".into(),
            },
        }],
    }
}

/// Async inter-canister search (canister only).
#[cfg(target_arch = "wasm32")]
pub async fn retrieve_from_canister(
    canister: Principal,
    query: &RetrievalQueryV1,
) -> Result<RetrievalResultV1, CoreError> {
    let top_k = query.limit.max(1).min(50);
    let result: Result<(Vec<KnowledgeHitDto>,), _> =
        ic_cdk::call(canister, "search", (query.text.clone(), top_k)).await;
    match result {
        Ok((hits,)) => Ok(hits_to_retrieval(hits)),
        Err((code, msg)) => Err(CoreError::Host(format!(
            "knowledge search failed ({code:?}): {msg}"
        ))),
    }
}

#[cfg(not(target_arch = "wasm32"))]
pub async fn retrieve_from_canister(
    _canister: Principal,
    query: &RetrievalQueryV1,
) -> Result<RetrievalResultV1, CoreError> {
    // Native unit tests never hit real canisters.
    Ok(mock_retrieve(query))
}

pub fn parse_principal(text: &str) -> Result<Principal, CoreError> {
    Principal::from_text(text.trim())
        .map_err(|e| CoreError::Host(format!("invalid knowledge principal: {e}")))
}
