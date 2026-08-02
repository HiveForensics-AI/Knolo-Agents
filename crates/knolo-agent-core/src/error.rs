use std::fmt;

/// Error produced before portable core operations can cause external effects.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum CoreError {
    InvalidIdentifier(String),
    InvalidGraph(String),
    InvalidPatch(String),
    RevisionConflict { expected: u64, actual: u64 },
    SchemaViolation(String),
    CheckpointIncompatible(String),
    PolicyDenied(crate::policy::PolicyDenialV1),
    Host(String),
}
impl fmt::Display for CoreError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{self:?}")
    }
}
impl std::error::Error for CoreError {}
