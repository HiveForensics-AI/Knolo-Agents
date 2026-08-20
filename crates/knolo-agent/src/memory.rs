use crate::task::TaskMemoryV1;
use knolo_agent_core::{
    AgentProfileV1, CoreError, MemoryRefV1, MemoryRetentionV1, MemorySensitivityV1,
};
use serde::{Deserialize, Serialize};
use std::{
    fs::{self, File},
    path::{Component, Path, PathBuf},
    time::{SystemTime, UNIX_EPOCH},
};

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct LocalMemoryRecordV1 {
    pub reference: MemoryRefV1,
    pub content: String,
}

pub struct LocalMemoryStore {
    root: PathBuf,
}

impl LocalMemoryStore {
    pub fn new(root: PathBuf) -> Self {
        Self { root }
    }

    pub fn list(&self, profile: &AgentProfileV1) -> Result<Vec<LocalMemoryRecordV1>, CoreError> {
        let path = self.path_for(profile)?;
        if !path.exists() {
            return Ok(Vec::new());
        }
        serde_json::from_reader(File::open(path).map_err(io_error)?).map_err(json_error)
    }

    pub fn recall(
        &self,
        profile: &AgentProfileV1,
        query: &str,
    ) -> Result<Vec<TaskMemoryV1>, CoreError> {
        let query_terms = terms(query);
        if query_terms.is_empty() {
            return Ok(Vec::new());
        }
        let mut scored = Vec::new();
        for record in self.list(profile)? {
            let Some(scope) = profile
                .memory_scopes
                .iter()
                .find(|scope| scope.namespace == record.reference.namespace && scope.can_read)
            else {
                continue;
            };
            let content_terms = terms(&record.content);
            let score = query_terms
                .iter()
                .filter(|term| content_terms.contains(*term))
                .count();
            if score > 0 {
                scored.push((score, record, scope.max_bytes));
            }
        }
        scored.sort_by(|left, right| right.0.cmp(&left.0));
        let mut total_bytes = 0_u32;
        Ok(scored
            .into_iter()
            .take(16)
            .filter_map(|(_, record, max_bytes)| {
                let content = record.content;
                let bytes = content.len() as u32;
                if total_bytes.saturating_add(bytes) > max_bytes {
                    return None;
                }
                total_bytes = total_bytes.saturating_add(bytes);
                Some(TaskMemoryV1 {
                    namespace: record.reference.namespace.to_string(),
                    content,
                })
            })
            .collect())
    }

    pub fn remember(
        &self,
        profile: &AgentProfileV1,
        namespace: &str,
        content: &str,
        source: &str,
    ) -> Result<MemoryRefV1, CoreError> {
        let namespace = namespace
            .parse()
            .map_err(|_| CoreError::Host("invalid memory namespace".into()))?;
        let scope = profile
            .memory_scopes
            .iter()
            .find(|scope| scope.namespace == namespace && scope.can_write)
            .ok_or_else(|| CoreError::AuthorityEscalation("memory write is not granted".into()))?;
        if content.trim().is_empty() || content.len() as u32 > scope.max_bytes {
            return Err(CoreError::Host(
                "memory content is empty or exceeds the scope limit".into(),
            ));
        }
        if source.trim().is_empty() {
            return Err(CoreError::Host("memory source is required".into()));
        }
        let now = now_ms()?;
        let reference = MemoryRefV1 {
            version: 1,
            id: format!("{}-{now}", profile.id),
            namespace,
            source: source.into(),
            sensitivity: MemorySensitivityV1::Internal,
            retention: MemoryRetentionV1::Durable,
            provenance: format!("local-memory:{}", profile.id),
        };
        reference.validate()?;
        let mut records = self.list(profile)?;
        records.push(LocalMemoryRecordV1 {
            reference: reference.clone(),
            content: content.into(),
        });
        if records.len() > scope.max_items as usize {
            let excess = records.len() - scope.max_items as usize;
            records.drain(0..excess);
        }
        self.write(profile, &records)?;
        Ok(reference)
    }

    fn write(
        &self,
        profile: &AgentProfileV1,
        records: &[LocalMemoryRecordV1],
    ) -> Result<(), CoreError> {
        let path = self.path_for(profile)?;
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent).map_err(io_error)?;
        }
        fs::write(
            path,
            serde_json::to_vec_pretty(records).map_err(json_error)?,
        )
        .map_err(io_error)
    }

    fn path_for(&self, profile: &AgentProfileV1) -> Result<PathBuf, CoreError> {
        let relative = Path::new(profile.id.as_str());
        if relative.is_absolute()
            || relative
                .components()
                .any(|component| matches!(component, Component::ParentDir))
        {
            return Err(CoreError::Host(
                "agent id cannot escape the memory directory".into(),
            ));
        }
        Ok(self.root.join(relative).with_extension("json"))
    }
}

fn terms(value: &str) -> std::collections::BTreeSet<String> {
    value
        .split(|character: char| !character.is_ascii_alphanumeric())
        .filter(|term| term.len() >= 3)
        .map(str::to_ascii_lowercase)
        .collect()
}

fn now_ms() -> Result<u128, CoreError> {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis())
        .map_err(|error| CoreError::Host(format!("clock: {error}")))
}

fn io_error(error: std::io::Error) -> CoreError {
    CoreError::Host(error.to_string())
}

fn json_error(error: serde_json::Error) -> CoreError {
    CoreError::Host(error.to_string())
}
