use crate::CoreError;
use serde::{Deserialize, Serialize};
use std::{fmt, str::FromStr};

macro_rules! identifier {
    ($name:ident) => {
        #[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
        #[serde(try_from = "String", into = "String")]
        pub struct $name(String);
        impl $name {
            pub fn new(value: impl Into<String>) -> Result<Self, CoreError> {
                let value = value.into();
                if value.is_empty()
                    || value.len() > 128
                    || !value
                        .chars()
                        .all(|c| c.is_ascii_alphanumeric() || matches!(c, '-' | '_' | '.' | '/'))
                {
                    return Err(CoreError::InvalidIdentifier(value));
                }
                Ok(Self(value))
            }
            pub fn as_str(&self) -> &str {
                &self.0
            }
        }
        impl TryFrom<String> for $name {
            type Error = CoreError;
            fn try_from(v: String) -> Result<Self, Self::Error> {
                Self::new(v)
            }
        }
        impl From<$name> for String {
            fn from(v: $name) -> Self {
                v.0
            }
        }
        impl fmt::Display for $name {
            fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
                f.write_str(&self.0)
            }
        }
        impl FromStr for $name {
            type Err = CoreError;
            fn from_str(v: &str) -> Result<Self, Self::Err> {
                Self::new(v)
            }
        }
    };
}
identifier!(GraphId);
identifier!(AgentId);
identifier!(NodeId);
identifier!(TransitionId);
identifier!(ExecutionId);
identifier!(PackId);
identifier!(NamespaceId);
identifier!(ToolId);
identifier!(CapabilityId);
identifier!(ClaimGraphId);
identifier!(StateSchemaId);

/// Versioned reference to a contract.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ContractRefV1<I> {
    pub version: u16,
    pub id: I,
}
impl<I> ContractRefV1<I> {
    pub fn new(id: I) -> Self {
        Self { version: 1, id }
    }
}
