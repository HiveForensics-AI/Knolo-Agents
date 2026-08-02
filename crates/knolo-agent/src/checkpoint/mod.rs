use knolo_agent_core::{checkpoint::CheckpointV1, node::CheckpointStore, CoreError, ExecutionId};
use std::collections::BTreeMap;
use std::fs;
use std::path::{Path, PathBuf};
#[derive(Debug, Default, Clone)]
pub struct InMemoryCheckpointStore {
    checkpoints: BTreeMap<ExecutionId, CheckpointV1>,
}

/// Crash-safe local checkpoint store. Writes are serialized to a temporary file
/// and atomically renamed, so readers never observe a partial checkpoint.
#[derive(Debug, Clone)]
pub struct FilesystemCheckpointStore {
    root: PathBuf,
}
impl FilesystemCheckpointStore {
    pub fn new(root: impl Into<PathBuf>) -> Result<Self, CoreError> {
        let root = root.into();
        fs::create_dir_all(&root).map_err(|e| CoreError::Host(e.to_string()))?;
        Ok(Self { root })
    }
    fn path(&self, id: &ExecutionId) -> PathBuf {
        self.root.join(format!("{}.json", id.as_str()))
    }
}
impl CheckpointStore for FilesystemCheckpointStore {
    fn save(&mut self, c: &CheckpointV1) -> Result<(), CoreError> {
        let path = self.path(&c.execution_id);
        let tmp = path.with_extension("json.tmp");
        let bytes = serde_json::to_vec(c).map_err(|e| CoreError::Host(e.to_string()))?;
        fs::write(&tmp, bytes).map_err(|e| CoreError::Host(e.to_string()))?;
        fs::rename(tmp, path).map_err(|e| CoreError::Host(e.to_string()))
    }
    fn load(&self, id: &ExecutionId) -> Result<Option<CheckpointV1>, CoreError> {
        let path = self.path(id);
        if !Path::new(&path).exists() {
            return Ok(None);
        }
        let bytes = fs::read(path).map_err(|e| CoreError::Host(e.to_string()))?;
        serde_json::from_slice(&bytes)
            .map(Some)
            .map_err(|e| CoreError::CheckpointIncompatible(e.to_string()))
    }
}
impl CheckpointStore for InMemoryCheckpointStore {
    fn save(&mut self, c: &CheckpointV1) -> Result<(), CoreError> {
        self.checkpoints.insert(c.execution_id.clone(), c.clone());
        Ok(())
    }
    fn load(&self, id: &ExecutionId) -> Result<Option<CheckpointV1>, CoreError> {
        Ok(self.checkpoints.get(id).cloned())
    }
}
