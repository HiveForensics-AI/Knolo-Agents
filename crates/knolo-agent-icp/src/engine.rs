//! Pure control-plane engine: load definition, start/step/resume, inject effects.
use crate::budget::HostBudgetTracker;
use crate::definition::LoadedDefinition;
use crate::executor::{is_host_effect_suspend, DeterministicExecutor};
use crate::host::{empty_sink, empty_store, fixed_clock};
use crate::tools_host::{default_registry, execute_tool_call};
use knolo_agent::host::ToolRegistry;
use knolo_agent::runtime::{
    ExecutionReportV1, ExecutionStatusV1, RuntimePolicyV1, Scheduler, VecEventSink,
};
use knolo_agent_core::{
    checkpoint::CheckpointV1, event::ExecutionEventV1, node::CheckpointStore,
    pack::CompiledPolicyV1, state::StateSnapshot, CoreError, ExecutionId, NodeId,
};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::BTreeMap;
use std::str::FromStr;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct ExecutionRecord {
    pub execution_id: String,
    pub status_kind: String,
    pub status_detail: String,
    pub steps: u64,
    pub tokens: u64,
    pub cost_micros: u64,
    pub state: StateSnapshot,
    pub events: Vec<ExecutionEventV1>,
    pub last_checkpoint: Option<CheckpointV1>,
    pub pending_resume: Option<CheckpointV1>,
    #[serde(default)]
    pub effect_cache: BTreeMap<String, Value>,
    #[serde(default)]
    pub timer_scheduled: bool,
}

#[derive(Default)]
pub struct AgentEngine {
    pub definition: Option<LoadedDefinition>,
    pub executions: BTreeMap<String, ExecutionRecord>,
    pub store: knolo_agent::checkpoint::InMemoryCheckpointStore,
    pub budget: HostBudgetTracker,
    pub tools: ToolRegistry,
}

impl AgentEngine {
    pub fn load_definition(&mut self, json: &str) -> Result<String, CoreError> {
        let loaded = crate::definition::AgentDefinitionBundleV1::load(json)?;
        let allow_https = loaded.bundle.host.allow_https_tools;
        let msg = format!(
            "Loaded graph '{}' with implementation '{}'.",
            loaded.compiled.definition().id,
            loaded.bundle.implementation_id
        );
        self.definition = Some(loaded);
        self.executions.clear();
        self.store = empty_store();
        self.budget = HostBudgetTracker::default();
        self.tools = default_registry(allow_https);
        Ok(msg)
    }

    pub fn clear_definition(&mut self) -> String {
        let had = self.definition.take().is_some();
        self.executions.clear();
        self.store = empty_store();
        self.budget = HostBudgetTracker::default();
        self.tools = ToolRegistry::default();
        if had {
            "Definition cleared.".into()
        } else {
            "No definition was loaded.".into()
        }
    }

    pub fn policy(&self) -> Option<&CompiledPolicyV1> {
        self.definition.as_ref().and_then(|d| d.policy.as_ref())
    }

    pub fn start_execution(
        &mut self,
        execution_id: &str,
        initial_state_json: &str,
    ) -> Result<ExecutionRecord, CoreError> {
        let state = parse_state(initial_state_json)?;
        let id = ExecutionId::from_str(execution_id)
            .map_err(|e| CoreError::Host(format!("invalid execution_id: {e}")))?;
        if self.executions.contains_key(execution_id) {
            return Err(CoreError::Host(format!(
                "execution '{execution_id}' already exists"
            )));
        }
        let report = self.run_from_start(&id, state, None, BTreeMap::new())?;
        let record = self.record_from_report(execution_id, report, BTreeMap::new())?;
        self.budget
            .sync_run_totals(record.steps, record.tokens, record.cost_micros);
        self.executions
            .insert(execution_id.to_owned(), record.clone());
        Ok(record)
    }

    pub fn step(
        &mut self,
        execution_id: &str,
        max_node_steps: u32,
    ) -> Result<ExecutionRecord, CoreError> {
        let existing = self
            .executions
            .get(execution_id)
            .cloned()
            .ok_or_else(|| CoreError::Host(format!("unknown execution '{execution_id}'")))?;

        if is_terminal(&existing.status_kind) {
            return Err(CoreError::Host(format!(
                "execution '{execution_id}' is already terminal ({})",
                existing.status_kind
            )));
        }

        let budget = if max_node_steps == 0 {
            None
        } else {
            Some(max_node_steps)
        };

        if existing.status_kind == "suspended"
            && !is_host_effect_suspend(&existing.status_detail)
            && existing.status_detail != "hitl_approval"
        {
            return Err(CoreError::Host(format!(
                "execution is suspended for '{}'; use resume after host input",
                existing.status_detail
            )));
        }

        if existing.status_kind == "suspended"
            && existing.status_detail == "hitl_approval"
            && max_node_steps != 0
        {
            return Err(CoreError::Host(
                "HITL suspension requires resume(), not step()".into(),
            ));
        }

        let checkpoint = self.checkpoint_for(&existing, execution_id)?;
        let id = ExecutionId::from_str(execution_id)
            .map_err(|e| CoreError::Host(format!("invalid execution_id: {e}")))?;
        let report = self.run_resume(
            &id,
            checkpoint,
            budget,
            false,
            existing.effect_cache.clone(),
        )?;
        let record = self.merge_step_report(execution_id, &existing, report)?;
        self.budget
            .sync_run_totals(record.steps, record.tokens, record.cost_micros);
        self.executions
            .insert(execution_id.to_owned(), record.clone());
        Ok(record)
    }

    pub fn resume(&mut self, execution_id: &str) -> Result<ExecutionRecord, CoreError> {
        let existing = self
            .executions
            .get(execution_id)
            .cloned()
            .ok_or_else(|| CoreError::Host(format!("unknown execution '{execution_id}'")))?;

        let hitl_approved =
            existing.status_kind == "suspended" && existing.status_detail == "hitl_approval";

        let checkpoint = if hitl_approved {
            self.checkpoint_for_hitl_resume(execution_id, &existing)?
        } else {
            self.checkpoint_for(&existing, execution_id)?
        };

        let id = ExecutionId::from_str(execution_id)
            .map_err(|e| CoreError::Host(format!("invalid execution_id: {e}")))?;
        let report = self.run_resume(
            &id,
            checkpoint,
            None,
            hitl_approved,
            existing.effect_cache.clone(),
        )?;
        let mut record = self.merge_step_report(execution_id, &existing, report)?;
        record.timer_scheduled = false;
        self.budget
            .sync_run_totals(record.steps, record.tokens, record.cost_micros);
        self.executions
            .insert(execution_id.to_owned(), record.clone());
        Ok(record)
    }

    /// Inject a host effect result and resume the suspended node.
    pub fn inject_effect_and_resume(
        &mut self,
        execution_id: &str,
        effect: &str,
        value: Value,
    ) -> Result<ExecutionRecord, CoreError> {
        let mut existing = self
            .executions
            .get(execution_id)
            .cloned()
            .ok_or_else(|| CoreError::Host(format!("unknown execution '{execution_id}'")))?;
        if existing.status_kind != "suspended" {
            return Err(CoreError::Host(format!(
                "execution is not suspended (status={})",
                existing.status_kind
            )));
        }
        let expected = match effect {
            "llm" => "await_llm",
            "tool" => "await_tool",
            "retrieve" => "await_retrieve",
            other => {
                return Err(CoreError::Host(format!("unknown effect kind '{other}'")));
            }
        };
        if existing.status_detail != expected {
            return Err(CoreError::Host(format!(
                "execution suspended for '{}' but inject is for '{expected}'",
                existing.status_detail
            )));
        }
        existing.effect_cache.insert(effect.into(), value);
        self.executions
            .insert(execution_id.to_owned(), existing.clone());
        self.resume(execution_id)
    }

    /// Execute pack-gated tool into effect cache payload (does not resume).
    pub fn run_tool_for_pending(&mut self, execution_id: &str) -> Result<Value, CoreError> {
        let existing = self
            .executions
            .get(execution_id)
            .ok_or_else(|| CoreError::Host(format!("unknown execution '{execution_id}'")))?;
        if existing.status_detail != "await_tool" {
            return Err(CoreError::Host("not awaiting tool".into()));
        }
        let tool_id = existing
            .state
            .value
            .pointer("/tool_id")
            .and_then(Value::as_str)
            .unwrap_or("echo");
        let arguments = existing
            .state
            .value
            .pointer("/tool_args")
            .cloned()
            .unwrap_or_else(|| serde_json::json!({ "message": "hello-from-icp" }));
        let policy = self.policy().cloned();
        let result = execute_tool_call(
            &mut self.tools,
            policy.as_ref(),
            &mut self.budget.ledger,
            tool_id,
            arguments,
            &format!("{execution_id}-tool"),
        )?;
        self.budget.note_tool_usage(
            result.usage.calls,
            result.usage.units,
            result.usage.duration_ms,
        );
        Ok(serde_json::json!({
            "tool_id": result.tool_id.as_str(),
            "call_id": result.call_id,
            "value": result.value,
            "usage": {
                "calls": result.usage.calls,
                "units": result.usage.units,
                "duration_ms": result.usage.duration_ms,
            },
            "cost_micros": result.usage.units.saturating_mul(10),
        }))
    }

    fn checkpoint_for(
        &self,
        existing: &ExecutionRecord,
        execution_id: &str,
    ) -> Result<CheckpointV1, CoreError> {
        if let Some(cp) = existing
            .pending_resume
            .clone()
            .or_else(|| existing.last_checkpoint.clone())
        {
            return Ok(cp);
        }
        if let Ok(id) = ExecutionId::from_str(execution_id) {
            if let Ok(Some(cp)) = self.store.load(&id) {
                return Ok(cp);
            }
        }
        // Synthesize for first-node effect suspends.
        self.synthesize_suspend_checkpoint(execution_id, existing)
    }

    fn synthesize_suspend_checkpoint(
        &self,
        execution_id: &str,
        existing: &ExecutionRecord,
    ) -> Result<CheckpointV1, CoreError> {
        let def = self
            .definition
            .as_ref()
            .ok_or_else(|| CoreError::Host("no definition loaded".into()))?;
        let pending = existing
            .events
            .iter()
            .rev()
            .find_map(|e| e.node_id.clone())
            .unwrap_or_else(|| def.compiled.definition().entry.clone());
        let id = ExecutionId::from_str(execution_id)
            .map_err(|e| CoreError::Host(format!("invalid execution_id: {e}")))?;
        Ok(CheckpointV1 {
            version: 1,
            execution_id: id,
            graph_hash: def.compiled.hash().into(),
            pack_hash: def.bundle.pack_hash.clone(),
            policy_hash: def.bundle.policy_hash.clone(),
            node_implementation_hash: def.node_implementation_hash.clone(),
            contract_hash: def.bundle.contract_hash.clone(),
            state: existing.state.clone(),
            pending_node: pending,
            event_cursor: existing.events.last().map(|e| e.sequence + 1).unwrap_or(1),
            steps: existing.steps,
            tokens: existing.tokens,
            cost_micros: existing.cost_micros,
        })
    }

    fn checkpoint_for_hitl_resume(
        &self,
        execution_id: &str,
        existing: &ExecutionRecord,
    ) -> Result<CheckpointV1, CoreError> {
        let mut cp = self.checkpoint_for(existing, execution_id)?;
        if cp.pending_node.as_str() != "await_human" {
            cp.pending_node =
                NodeId::from_str("await_human").map_err(|e| CoreError::Host(e.to_string()))?;
            cp.state = existing.state.clone();
            cp.steps = existing.steps;
            cp.tokens = existing.tokens;
            cp.cost_micros = existing.cost_micros;
            cp.event_cursor = existing.events.last().map(|e| e.sequence + 1).unwrap_or(1);
        }
        Ok(cp)
    }

    fn run_from_start(
        &mut self,
        id: &ExecutionId,
        state: StateSnapshot,
        step_budget: Option<u32>,
        effect_cache: BTreeMap<String, Value>,
    ) -> Result<ExecutionReportV1, CoreError> {
        let def = self
            .definition
            .as_ref()
            .ok_or_else(|| CoreError::Host("no definition loaded".into()))?;
        let policy = policy_from(def);
        let mut executor = DeterministicExecutor::new(def.bundle.implementation_id.clone())
            .with_effect_cache(effect_cache);
        if let Some(n) = step_budget {
            executor = executor.with_step_budget(n);
        }
        let mut sink = empty_sink();
        let clock = fixed_clock();
        let mut store = std::mem::take(&mut self.store);
        let report = {
            let mut scheduler = Scheduler::new(
                &def.compiled,
                &def.bundle.schema,
                &mut executor,
                &mut sink,
                &clock,
                &mut store,
                policy,
            );
            scheduler.run(id.clone(), state, || false)
        };
        self.store = store;
        report
    }

    fn run_resume(
        &mut self,
        _id: &ExecutionId,
        checkpoint: CheckpointV1,
        step_budget: Option<u32>,
        hitl_approved: bool,
        effect_cache: BTreeMap<String, Value>,
    ) -> Result<ExecutionReportV1, CoreError> {
        let def = self
            .definition
            .as_ref()
            .ok_or_else(|| CoreError::Host("no definition loaded".into()))?;
        let policy = policy_from(def);
        let mut executor = DeterministicExecutor::new(def.bundle.implementation_id.clone())
            .with_hitl_approved(hitl_approved)
            .with_effect_cache(effect_cache);
        if let Some(n) = step_budget {
            executor = executor.with_step_budget(n);
        }
        let mut sink = empty_sink();
        let clock = fixed_clock();
        let mut store = std::mem::take(&mut self.store);
        let report = {
            let mut scheduler = Scheduler::new(
                &def.compiled,
                &def.bundle.schema,
                &mut executor,
                &mut sink,
                &clock,
                &mut store,
                policy,
            );
            scheduler.resume(checkpoint, || false)
        };
        self.store = store;
        report
    }

    fn record_from_report(
        &self,
        execution_id: &str,
        report: ExecutionReportV1,
        effect_cache: BTreeMap<String, Value>,
    ) -> Result<ExecutionRecord, CoreError> {
        let (status_kind, status_detail) = status_parts(&report.status);
        let id = ExecutionId::from_str(execution_id)
            .map_err(|e| CoreError::Host(format!("invalid execution_id: {e}")))?;
        let last_checkpoint = self.store.load(&id)?;
        let pending_resume = if status_kind == "suspended" && is_host_effect_suspend(&status_detail)
        {
            last_checkpoint.clone().or_else(|| {
                self.synthesize_suspend_checkpoint(
                    execution_id,
                    &ExecutionRecord {
                        execution_id: execution_id.into(),
                        status_kind: status_kind.clone(),
                        status_detail: status_detail.clone(),
                        steps: report.steps,
                        tokens: report.tokens,
                        cost_micros: report.cost_micros,
                        state: report.state.clone(),
                        events: report.events.clone(),
                        last_checkpoint: None,
                        pending_resume: None,
                        effect_cache: effect_cache.clone(),
                        timer_scheduled: false,
                    },
                )
                .ok()
            })
        } else {
            None
        };
        Ok(ExecutionRecord {
            execution_id: execution_id.into(),
            status_kind,
            status_detail,
            steps: report.steps,
            tokens: report.tokens,
            cost_micros: report.cost_micros,
            state: report.state,
            events: report.events,
            last_checkpoint: last_checkpoint.or_else(|| pending_resume.clone()),
            pending_resume,
            effect_cache,
            timer_scheduled: false,
        })
    }

    fn merge_step_report(
        &self,
        execution_id: &str,
        previous: &ExecutionRecord,
        report: ExecutionReportV1,
    ) -> Result<ExecutionRecord, CoreError> {
        let (status_kind, status_detail) = status_parts(&report.status);
        let id = ExecutionId::from_str(execution_id)
            .map_err(|e| CoreError::Host(format!("invalid execution_id: {e}")))?;
        let last_checkpoint = self
            .store
            .load(&id)?
            .or_else(|| previous.last_checkpoint.clone());
        let mut pending_resume =
            if status_kind == "suspended" && is_host_effect_suspend(&status_detail) {
                last_checkpoint.clone()
            } else {
                None
            };
        if status_kind == "suspended"
            && is_host_effect_suspend(&status_detail)
            && pending_resume.is_none()
        {
            pending_resume = self
                .synthesize_suspend_checkpoint(
                    execution_id,
                    &ExecutionRecord {
                        execution_id: execution_id.into(),
                        status_kind: status_kind.clone(),
                        status_detail: status_detail.clone(),
                        steps: report.steps,
                        tokens: report.tokens,
                        cost_micros: report.cost_micros,
                        state: report.state.clone(),
                        events: report.events.clone(),
                        last_checkpoint: last_checkpoint.clone(),
                        pending_resume: None,
                        effect_cache: previous.effect_cache.clone(),
                        timer_scheduled: false,
                    },
                )
                .ok();
        }

        let mut events = previous.events.clone();
        let base = events.last().map(|e| e.sequence).unwrap_or(0);
        for mut e in report.events {
            if e.sequence <= base {
                e.sequence = base + e.sequence.saturating_add(1);
            }
            events.push(e);
        }

        Ok(ExecutionRecord {
            execution_id: execution_id.into(),
            status_kind,
            status_detail,
            steps: report.steps,
            tokens: report.tokens,
            cost_micros: report.cost_micros,
            state: report.state,
            events,
            last_checkpoint: last_checkpoint.or_else(|| pending_resume.clone()),
            pending_resume,
            effect_cache: previous.effect_cache.clone(),
            timer_scheduled: false,
        })
    }
}

fn is_terminal(kind: &str) -> bool {
    matches!(kind, "terminated" | "failed" | "cancelled")
}

fn policy_from(def: &LoadedDefinition) -> RuntimePolicyV1 {
    RuntimePolicyV1 {
        max_retries: 0,
        retry_delay_ms: 0,
        pack_hash: def.bundle.pack_hash.clone(),
        policy_hash: def.bundle.policy_hash.clone(),
        node_implementation_hash: def.node_implementation_hash.clone(),
        contract_hash: def.bundle.contract_hash.clone(),
    }
}

fn parse_state(json: &str) -> Result<StateSnapshot, CoreError> {
    serde_json::from_str(json).map_err(|e| CoreError::Host(format!("invalid state JSON: {e}")))
}

fn status_parts(status: &ExecutionStatusV1) -> (String, String) {
    match status {
        ExecutionStatusV1::Suspended(reason) => ("suspended".into(), reason.clone()),
        ExecutionStatusV1::Terminated(v) => (
            "terminated".into(),
            serde_json::to_string(v).unwrap_or_else(|_| "null".into()),
        ),
        ExecutionStatusV1::Failed(e) => ("failed".into(), e.clone()),
        ExecutionStatusV1::Cancelled => ("cancelled".into(), String::new()),
    }
}

pub fn start_with_budget(
    engine: &mut AgentEngine,
    execution_id: &str,
    initial_state_json: &str,
    max_node_steps: u32,
) -> Result<ExecutionRecord, CoreError> {
    let state = parse_state(initial_state_json)?;
    let id = ExecutionId::from_str(execution_id)
        .map_err(|e| CoreError::Host(format!("invalid execution_id: {e}")))?;
    if engine.executions.contains_key(execution_id) {
        return Err(CoreError::Host(format!(
            "execution '{execution_id}' already exists"
        )));
    }
    let budget = if max_node_steps == 0 {
        None
    } else {
        Some(max_node_steps)
    };
    let report = engine.run_from_start(&id, state, budget, BTreeMap::new())?;
    let record = engine.record_from_report(execution_id, report, BTreeMap::new())?;
    engine
        .executions
        .insert(execution_id.to_owned(), record.clone());
    Ok(record)
}

#[allow(dead_code)]
fn _sink_typecheck() -> VecEventSink {
    empty_sink()
}
