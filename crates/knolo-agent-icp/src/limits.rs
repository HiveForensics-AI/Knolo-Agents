//! DoS and resource limits for the multi-tenant agent runtime (Phase 3).
use serde::{Deserialize, Serialize};

/// Soft ceilings enforced by the canister host (not graph limits).
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct RuntimeLimitsV1 {
    /// Maximum concurrent execution records retained in stable memory.
    pub max_concurrent_executions: u32,
    /// Maximum ordered events retained per execution.
    pub max_events_per_execution: u32,
    /// Maximum length of an execution id string.
    pub max_execution_id_len: u32,
    /// Maximum initial state JSON size (bytes).
    pub max_state_bytes: u32,
    /// Maximum handoff envelope JSON size (bytes).
    pub max_handoff_bytes: u32,
    /// Maximum total size of a serialized execution record (approx).
    pub max_execution_record_bytes: u32,
    /// When true, only controllers may start/step/resume executions.
    pub require_controller_for_runs: bool,
    /// Principals allowed to run executions (text). Empty = any caller
    /// (unless `require_controller_for_runs`).
    #[serde(default)]
    pub allowed_callers: Vec<String>,
    /// Refuse new work when canister balance is below this (0 = disabled).
    pub min_cycles_reserve: u128,
    /// Schema version of this limits blob (for migrations).
    pub version: u16,
}

impl Default for RuntimeLimitsV1 {
    fn default() -> Self {
        Self {
            max_concurrent_executions: 32,
            max_events_per_execution: 10_000,
            max_execution_id_len: 128,
            max_state_bytes: 512 * 1024,
            max_handoff_bytes: 256 * 1024,
            max_execution_record_bytes: 2 * 1024 * 1024,
            require_controller_for_runs: false,
            allowed_callers: Vec::new(),
            min_cycles_reserve: 0,
            version: 1,
        }
    }
}

impl RuntimeLimitsV1 {
    pub fn validate_execution_id(&self, execution_id: &str) -> Result<(), String> {
        if execution_id.is_empty() {
            return Err("execution_id must be non-empty".into());
        }
        if execution_id.len() > self.max_execution_id_len as usize {
            return Err(format!(
                "execution_id length {} exceeds max {}",
                execution_id.len(),
                self.max_execution_id_len
            ));
        }
        if !execution_id
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_' || c == '.')
        {
            return Err("execution_id may only contain ASCII alphanumerics, '-', '_', '.'".into());
        }
        Ok(())
    }

    pub fn validate_state_bytes(&self, state_json: &str) -> Result<(), String> {
        if state_json.len() > self.max_state_bytes as usize {
            return Err(format!(
                "state JSON size {} exceeds max {}",
                state_json.len(),
                self.max_state_bytes
            ));
        }
        Ok(())
    }

    pub fn validate_handoff_bytes(&self, envelope_json: &str) -> Result<(), String> {
        if envelope_json.len() > self.max_handoff_bytes as usize {
            return Err(format!(
                "handoff envelope size {} exceeds max {}",
                envelope_json.len(),
                self.max_handoff_bytes
            ));
        }
        Ok(())
    }

    pub fn check_capacity(&self, current_executions: usize) -> Result<(), String> {
        if current_executions >= self.max_concurrent_executions as usize {
            return Err(format!(
                "max concurrent executions reached ({})",
                self.max_concurrent_executions
            ));
        }
        Ok(())
    }

    pub fn truncate_events_if_needed<T>(&self, events: &mut Vec<T>) {
        let max = self.max_events_per_execution as usize;
        if events.len() > max {
            // Keep the newest events (tail); drop oldest.
            let drop_n = events.len() - max;
            events.drain(0..drop_n);
        }
    }
}

/// Pack / definition identity metadata stored alongside the loaded definition.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, Default)]
pub struct PackMetaV1 {
    pub pack_hash: String,
    pub policy_hash: String,
    pub contract_hash: String,
    pub graph_id: String,
    pub graph_hash: String,
    pub implementation_id: String,
    pub pack_id: Option<String>,
}
