use knolo_agent_core::{checkpoint::CheckpointV1, node::CheckpointStore, CoreError, ExecutionId};
use std::collections::BTreeMap;
#[derive(Debug, Default, Clone)]
pub struct InMemoryCheckpointStore {
    checkpoints: BTreeMap<ExecutionId, CheckpointV1>,
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
