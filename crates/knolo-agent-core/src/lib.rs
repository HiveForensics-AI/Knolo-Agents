//! Stable, provider-neutral primitives for Knolo agents.

/// Identifies a pack that can be installed or executed by an agent.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PackId(String);

impl PackId {
    /// Creates a pack identifier from a non-empty name.
    pub fn new(name: impl Into<String>) -> Option<Self> {
        let name = name.into();
        (!name.trim().is_empty()).then_some(Self(name))
    }

    /// Returns the identifier as text.
    pub fn as_str(&self) -> &str {
        &self.0
    }
}
