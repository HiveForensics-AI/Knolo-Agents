use crate::{CoreError, NamespaceId};
use serde::{Deserialize, Serialize};

/// Sensitivity is metadata for host policy and redaction; it never grants
/// access by itself.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum MemorySensitivityV1 {
    Public,
    Internal,
    Sensitive,
    Restricted,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", content = "days", rename_all = "snake_case")]
pub enum MemoryRetentionV1 {
    Run,
    Session,
    Durable,
    Days(u32),
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct MemoryScopeV1 {
    pub version: u16,
    pub namespace: NamespaceId,
    pub can_read: bool,
    pub can_write: bool,
    pub max_items: u32,
    pub max_bytes: u32,
}

impl MemoryScopeV1 {
    pub fn validate(&self) -> Result<(), CoreError> {
        if self.version != 1 {
            return Err(CoreError::InvalidProfile(
                "unsupported memory scope version".into(),
            ));
        }
        if self.namespace.as_str().trim().is_empty() {
            return Err(CoreError::InvalidProfile(
                "memory namespace cannot be empty".into(),
            ));
        }
        if (self.can_read || self.can_write) && (self.max_items == 0 || self.max_bytes == 0) {
            return Err(CoreError::InvalidProfile(
                "enabled memory scopes require positive limits".into(),
            ));
        }
        Ok(())
    }

    pub fn read(namespace: NamespaceId, max_items: u32, max_bytes: u32) -> Self {
        Self {
            version: 1,
            namespace,
            can_read: true,
            can_write: false,
            max_items,
            max_bytes,
        }
    }

    pub fn read_write(namespace: NamespaceId, max_items: u32, max_bytes: u32) -> Self {
        Self {
            version: 1,
            namespace,
            can_read: true,
            can_write: true,
            max_items,
            max_bytes,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct MemoryRefV1 {
    pub version: u16,
    pub id: String,
    pub namespace: NamespaceId,
    pub source: String,
    pub sensitivity: MemorySensitivityV1,
    pub retention: MemoryRetentionV1,
    pub provenance: String,
}

impl MemoryRefV1 {
    pub fn validate(&self) -> Result<(), CoreError> {
        if self.version != 1 {
            return Err(CoreError::Host(
                "unsupported memory reference version".into(),
            ));
        }
        if self.id.trim().is_empty()
            || self.source.trim().is_empty()
            || self.provenance.trim().is_empty()
        {
            return Err(CoreError::Host(
                "memory id, source, and provenance are required".into(),
            ));
        }
        Ok(())
    }
}
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum MemoryOperationV1 {
    Recall {
        namespace: NamespaceId,
        query: String,
        limit: u32,
    },
    Remember {
        namespace: NamespaceId,
        content: String,
        sensitivity: MemorySensitivityV1,
        retention: MemoryRetentionV1,
        provenance: String,
    },
    Forget {
        namespace: NamespaceId,
        id: String,
    },
}

impl MemoryOperationV1 {
    pub fn validate(&self) -> Result<(), CoreError> {
        match self {
            Self::Recall {
                namespace,
                query,
                limit,
            } => {
                if namespace.as_str().is_empty() || query.trim().is_empty() || *limit == 0 {
                    return Err(CoreError::Host(
                        "memory recall requires namespace, query, and positive limit".into(),
                    ));
                }
            }
            Self::Remember {
                namespace,
                content,
                provenance,
                ..
            } => {
                if namespace.as_str().is_empty()
                    || content.trim().is_empty()
                    || provenance.trim().is_empty()
                {
                    return Err(CoreError::Host(
                        "memory write requires namespace, content, and provenance".into(),
                    ));
                }
            }
            Self::Forget { namespace, id } => {
                if namespace.as_str().is_empty() || id.trim().is_empty() {
                    return Err(CoreError::Host(
                        "memory forget requires namespace and id".into(),
                    ));
                }
            }
        }
        Ok(())
    }
}
