//! Safe event-sourced replay policy and artifact compatibility checks.
use crate::CoreError;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ReplayModeV1 {
    VerifyOnly,
    MockedEffects,
    LiveEffects,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ArtifactHashesV1 {
    pub graph: String,
    pub pack: String,
    pub policy: String,
    pub node_implementation: String,
    pub contract: String,
}

impl ArtifactHashesV1 {
    pub fn verify(&self, actual: &Self) -> Result<(), CoreError> {
        if self != actual {
            return Err(CoreError::ReplayRejected("artifact hash mismatch".into()));
        }
        Ok(())
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ReplayRequestV1 {
    pub version: u16,
    pub mode: ReplayModeV1,
    pub artifacts: ArtifactHashesV1,
    pub live_effect_authorization: Option<String>,
}
impl ReplayRequestV1 {
    pub fn validate(&self, actual: &ArtifactHashesV1) -> Result<(), CoreError> {
        if self.version != 1 {
            return Err(CoreError::ReplayRejected(
                "unsupported replay version".into(),
            ));
        }
        self.artifacts.verify(actual)?;
        if self.mode == ReplayModeV1::LiveEffects
            && self
                .live_effect_authorization
                .as_deref()
                .unwrap_or("")
                .is_empty()
        {
            return Err(CoreError::ReplayRejected(
                "live effects require explicit authorization".into(),
            ));
        }
        Ok(())
    }
}
