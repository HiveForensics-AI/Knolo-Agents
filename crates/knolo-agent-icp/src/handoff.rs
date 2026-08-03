//! Multi-agent handoff via `HandoffEnvelopeV1` (Phase 3).
//!
//! Accepts narrowed envelopes, validates against parent + pack authority, and
//! starts a local execution. Optional inter-canister forward targets a peer
//! agent runtime's `accept_handoff` method.
use crate::limits::RuntimeLimitsV1;
use candid::{CandidType, Principal};
use knolo_agent_core::handoff::{AuthorityV1, HandoffEnvelopeV1};
use knolo_agent_core::pack::PackDeclarationV1;
use knolo_agent_core::CoreError;
use serde::{Deserialize, Serialize};
use std::collections::BTreeSet;

/// Durable audit record for an accepted or forwarded handoff.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct HandoffRecordV1 {
    pub version: u16,
    pub handoff_id: String,
    pub execution_id: String,
    pub destination: String,
    pub return_contract: String,
    pub parent_authority: AuthorityV1,
    pub child_authority: AuthorityV1,
    pub status: String,
    pub peer_canister: Option<String>,
    pub message: String,
}

/// Build pack authority used as the hard ceiling for handoff narrowing.
pub fn authority_from_pack(
    pack: Option<&PackDeclarationV1>,
    graph_max_steps: u64,
    graph_max_cost_micros: u64,
) -> AuthorityV1 {
    match pack {
        Some(p) => AuthorityV1 {
            capabilities: p
                .capability_bindings
                .keys()
                .map(|c| c.to_string())
                .collect::<BTreeSet<_>>(),
            namespaces: p
                .namespaces
                .iter()
                .map(|n| n.to_string())
                .collect::<BTreeSet<_>>(),
            max_steps: graph_max_steps,
            max_cost_micros: graph_max_cost_micros,
        },
        None => AuthorityV1 {
            capabilities: BTreeSet::new(),
            namespaces: BTreeSet::new(),
            max_steps: graph_max_steps,
            max_cost_micros: graph_max_cost_micros,
        },
    }
}

/// Parse and validate a handoff envelope against parent + pack authority.
pub fn parse_and_validate_envelope(
    envelope_json: &str,
    parent: &AuthorityV1,
    pack: &AuthorityV1,
    limits: &RuntimeLimitsV1,
) -> Result<HandoffEnvelopeV1, CoreError> {
    limits
        .validate_handoff_bytes(envelope_json)
        .map_err(CoreError::Host)?;
    let envelope: HandoffEnvelopeV1 = serde_json::from_str(envelope_json)
        .map_err(|e| CoreError::Host(format!("invalid handoff envelope JSON: {e}")))?;
    envelope.validate(parent, pack)?;
    Ok(envelope)
}

pub fn parse_authority(json: &str) -> Result<AuthorityV1, CoreError> {
    serde_json::from_str(json).map_err(|e| CoreError::Host(format!("invalid authority JSON: {e}")))
}

/// Candid-friendly handoff DTO.
#[derive(CandidType, Deserialize, Clone, Debug, PartialEq, Eq)]
pub struct HandoffDto {
    pub ok: bool,
    pub handoff_id: String,
    pub execution_id: String,
    pub destination: String,
    pub status: String,
    pub message: String,
}

impl HandoffDto {
    pub fn from_record(r: &HandoffRecordV1) -> Self {
        Self {
            ok: r.status == "accepted" || r.status == "forwarded",
            handoff_id: r.handoff_id.clone(),
            execution_id: r.execution_id.clone(),
            destination: r.destination.clone(),
            status: r.status.clone(),
            message: r.message.clone(),
        }
    }

    pub fn err(message: impl Into<String>) -> Self {
        Self {
            ok: false,
            handoff_id: String::new(),
            execution_id: String::new(),
            destination: String::new(),
            status: "error".into(),
            message: message.into(),
        }
    }
}

/// Inter-canister call to a peer agent runtime (wasm only).
pub async fn forward_to_peer(
    peer: Principal,
    execution_id: String,
    envelope_json: String,
    state_json: String,
    parent_authority_json: String,
) -> Result<HandoffDto, CoreError> {
    #[cfg(target_arch = "wasm32")]
    {
        let result: Result<(HandoffDto,), _> = ic_cdk::api::call::call(
            peer,
            "accept_handoff",
            (
                execution_id,
                envelope_json,
                state_json,
                parent_authority_json,
            ),
        )
        .await
        .map_err(|(code, msg)| CoreError::Host(format!("handoff forward ({code:?}): {msg}")));
        result.map(|(dto,)| dto)
    }
    #[cfg(not(target_arch = "wasm32"))]
    {
        let _ = (
            peer,
            execution_id,
            envelope_json,
            state_json,
            parent_authority_json,
        );
        Err(CoreError::Host(
            "inter-canister handoff forward is only available on wasm32 ICP host".into(),
        ))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn rejects_authority_escalation() {
        let parent = AuthorityV1 {
            capabilities: BTreeSet::from(["read".into()]),
            namespaces: BTreeSet::from(["ns".into()]),
            max_steps: 10,
            max_cost_micros: 100,
        };
        let pack = parent.clone();
        let envelope = json!({
            "version": 1,
            "destination": "child-graph",
            "state_projection": { "/x": "/x" },
            "authority_projection": {
                "capabilities": ["read", "write"],
                "namespaces": ["ns"],
                "max_steps": 5,
                "max_cost_micros": 50
            },
            "return_contract": "child-return-v1"
        })
        .to_string();
        let limits = RuntimeLimitsV1::default();
        let err = parse_and_validate_envelope(&envelope, &parent, &pack, &limits).unwrap_err();
        assert!(err.to_string().contains("escalation") || err.to_string().contains("authority"));
    }

    #[test]
    fn accepts_narrowed_envelope() {
        let parent = AuthorityV1 {
            capabilities: BTreeSet::from(["read".into(), "write".into()]),
            namespaces: BTreeSet::from(["ns".into()]),
            max_steps: 10,
            max_cost_micros: 100,
        };
        let pack = parent.clone();
        let envelope = json!({
            "version": 1,
            "destination": "child-graph",
            "state_projection": { "/x": "/x" },
            "authority_projection": {
                "capabilities": ["read"],
                "namespaces": ["ns"],
                "max_steps": 5,
                "max_cost_micros": 50
            },
            "return_contract": "child-return-v1"
        })
        .to_string();
        let limits = RuntimeLimitsV1::default();
        let env = parse_and_validate_envelope(&envelope, &parent, &pack, &limits).unwrap();
        assert_eq!(env.destination.as_str(), "child-graph");
    }
}
