//! Durable, typed human-in-the-loop suspension contracts.
use crate::{CoreError, ExecutionId};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use sha2::{Digest, Sha256};

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct SuspensionV1 {
    pub version: u16,
    pub execution_id: ExecutionId,
    pub reason: String,
    pub requested_action: String,
    pub review_context: Value,
    pub expires_at_ms: u64,
    pub resume_schema_hash: String,
    pub artifact_hashes: crate::replay::ArtifactHashesV1,
    pub nonce: String,
}

impl SuspensionV1 {
    pub fn token(&self) -> Result<String, CoreError> {
        let bytes = serde_json::to_vec(self).map_err(|e| CoreError::Host(e.to_string()))?;
        Ok(format!("{:x}", Sha256::digest(bytes)))
    }
    pub fn validate_resume(
        &self,
        token: &str,
        now_ms: u64,
        schema_hash: &str,
        input: &Value,
    ) -> Result<(), CoreError> {
        if self.version != 1 || now_ms >= self.expires_at_ms || token != self.token()? {
            return Err(CoreError::ResumeRejected(
                "stale or invalid resume token".into(),
            ));
        }
        if schema_hash != self.resume_schema_hash || !input.is_object() {
            return Err(CoreError::ResumeRejected(
                "resume input does not match its bound schema".into(),
            ));
        }
        Ok(())
    }
}
