use crate::{ClaimGraphId, CoreError};
use serde::{Deserialize, Serialize};
use serde_json::Value;

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct RetrievalQueryV1 {
    pub version: u16,
    pub text: String,
    pub limit: u32,
}
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct EvidenceProvenanceV1 {
    pub source_id: String,
    pub locator: String,
    pub content_hash: String,
}
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct RetrievalEvidenceV1 {
    pub content: Value,
    pub score_micros: u32,
    pub provenance: EvidenceProvenanceV1,
}
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct RetrievalResultV1 {
    pub version: u16,
    pub evidence: Vec<RetrievalEvidenceV1>,
}
/// Boundary implemented by an injected `@knolo/core`-compatible Cortex adapter.
pub trait CortexCapability {
    fn retrieve(&mut self, query: &RetrievalQueryV1) -> Result<RetrievalResultV1, CoreError>;
}
pub struct RetrieverNode<C> {
    cortex: C,
}
impl<C: CortexCapability> RetrieverNode<C> {
    pub fn new(cortex: C) -> Self {
        Self { cortex }
    }
    pub fn execute(&mut self, q: &RetrievalQueryV1) -> Result<RetrievalResultV1, CoreError> {
        self.cortex.retrieve(q)
    }
}
/// ClaimGraph remains owned by Knolo core; agents only consume this versioned port.
pub trait ClaimGraphCapability {
    fn read(&mut self, graph: &ClaimGraphId, query: Value) -> Result<Value, CoreError>;
    fn write(&mut self, graph: &ClaimGraphId, mutation: Value) -> Result<Value, CoreError>;
}
