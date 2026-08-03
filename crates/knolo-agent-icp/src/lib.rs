//! ICP canister host for the Knolo agent control plane (Phases 1–3).
//!
//! Phase 1: pure deterministic graphs, checkpoints, ordered events.
//! Phase 2: pack-gated tools, ic-llm, knowledge retrieval, timers, cycles budget.
//! Phase 3: ic-stable-structures, DoS/auth hardening, multi-agent handoff.
mod auth;
mod budget;
mod definition;
mod dto;
mod effects;
mod engine;
mod executor;
mod handoff;
mod host;
mod knowledge;
mod limits;
mod stable_store;
mod tools_host;

pub use definition::{
    AgentDefinitionBundleV1, HostConfigV1, LoadedDefinition, MAX_DEFINITION_BYTES,
};
pub use dto::*;
pub use engine::{start_with_budget, AgentEngine, ExecutionRecord};
pub use executor::DeterministicExecutor;
pub use handoff::{HandoffDto, HandoffRecordV1};
pub use host::{fixed_clock, DETERMINISTIC_NOW_MS};
pub use limits::{PackMetaV1, RuntimeLimitsV1};
pub use tools_host::permissive_tools_pack;

use engine::AgentEngine as Engine;
use ic_cdk::api::{caller, is_controller};
use ic_cdk_macros::{post_upgrade, pre_upgrade, query, update};
use knolo_agent_core::node::CheckpointStore;
use std::cell::RefCell;

thread_local! {
    static ENGINE: RefCell<Engine> = RefCell::new(Engine::default());
}

// --- Candid surface ----------------------------------------------------------

#[query]
fn health() -> HealthDto {
    ENGINE.with(|e| {
        let eng = e.borrow();
        if eng.definition.is_some() {
            HealthDto::ok(
                "Agent runtime ready (definition loaded). Phase 3 stable structures enabled.",
            )
        } else {
            HealthDto {
                ok: false,
                message: "No definition loaded. Call load_definition first.".into(),
            }
        }
    })
}

#[query]
fn inspect() -> InspectionDto {
    let stats = stable_store::store_stats();
    ENGINE.with(|e| {
        let eng = e.borrow();
        match eng.definition.as_ref() {
            Some(def) => {
                let host = &def.bundle.host;
                InspectionDto {
                    ok: true,
                    engine: "icp".into(),
                    graph_loaded: true,
                    graph_id: Some(def.compiled.definition().id.to_string()),
                    graph_hash: Some(def.compiled.hash().into()),
                    implementation_id: Some(def.bundle.implementation_id.clone()),
                    execution_count: eng.executions.len() as u64,
                    capabilities: vec![
                        "state".into(),
                        "routing".into(),
                        "suspension".into(),
                        "checkpoints".into(),
                        "ordered_events".into(),
                        "deterministic_replay".into(),
                        "pack_policy".into(),
                        "tools".into(),
                        "llm".into(),
                        "retrieval".into(),
                        "timers".into(),
                        "cycles_budget".into(),
                        "stable_structures".into(),
                        "multi_agent_handoff".into(),
                        "runtime_limits".into(),
                    ],
                    limitations: vec![
                        if host.llm_enabled {
                            "llm via ic-llm (async suspend/resume)".into()
                        } else {
                            "llm disabled".into()
                        },
                        if host.knowledge_canister.is_some() {
                            "retrieval via knowledge canister".into()
                        } else {
                            "retrieval falls back to mock without knowledge_canister".into()
                        },
                        if host.allow_https_tools {
                            "https tools allowed (outcall/mock)".into()
                        } else {
                            "https tools disabled".into()
                        },
                        format!(
                            "stable schema v{} (ic-stable-structures)",
                            stats.schema_version
                        ),
                        format!(
                            "max concurrent executions={}",
                            eng.limits.max_concurrent_executions
                        ),
                    ],
                    message: "Phase 3: upgrade-safe host with handoff + hardening.".into(),
                    schema_version: stats.schema_version,
                    handoff_count: eng.handoffs.len() as u64,
                }
            }
            None => InspectionDto {
                ok: false,
                engine: "icp".into(),
                graph_loaded: false,
                graph_id: None,
                graph_hash: None,
                implementation_id: None,
                execution_count: 0,
                capabilities: vec!["state".into(), "routing".into(), "suspension".into()],
                limitations: vec!["no definition loaded".into()],
                message: "Load a definition to inspect a graph.".into(),
                schema_version: stats.schema_version,
                handoff_count: 0,
            },
        }
    })
}

#[query]
fn get_budget() -> BudgetDto {
    ENGINE.with(|e| BudgetDto::from(&e.borrow().budget.snapshot))
}

#[query]
fn get_limits() -> LimitsDto {
    ENGINE.with(|e| LimitsDto::from(&e.borrow().limits))
}

#[query]
fn get_store_stats() -> StoreStatsDto {
    StoreStatsDto::from(&stable_store::store_stats())
}

#[query]
fn list_executions() -> ExecutionListDto {
    ENGINE.with(|e| {
        let ids: Vec<String> = e.borrow().executions.keys().cloned().collect();
        ExecutionListDto {
            ok: true,
            message: format!("{} executions", ids.len()),
            execution_ids: ids,
        }
    })
}

#[update]
fn load_definition(json: String) -> HealthDto {
    if let Err(err) = require_controller() {
        return err;
    }
    let result = ENGINE.with(|e| e.borrow_mut().load_definition(&json));
    match result {
        Ok(msg) => {
            if let Err(persist_err) = persist_current() {
                return HealthDto::err(format!("loaded but failed to persist: {persist_err}"));
            }
            HealthDto::ok(msg)
        }
        Err(err) => HealthDto::err(err.to_string()),
    }
}

#[update]
fn clear_definition() -> HealthDto {
    if let Err(err) = require_controller() {
        return err;
    }
    let msg = ENGINE.with(|e| e.borrow_mut().clear_definition());
    if let Err(persist_err) = persist_current() {
        return HealthDto::err(format!("{msg} Persist failed: {persist_err}"));
    }
    HealthDto::ok(msg)
}

#[update]
fn set_limits(
    max_concurrent_executions: u32,
    max_events_per_execution: u32,
    max_state_bytes: u32,
    require_controller_for_runs: bool,
    allowed_callers: Vec<String>,
    min_cycles_reserve: u64,
) -> LimitsDto {
    if let Err(err) = require_controller() {
        return LimitsDto::err(err.message);
    }
    let mut limits = ENGINE.with(|e| e.borrow().limits.clone());
    if max_concurrent_executions > 0 {
        limits.max_concurrent_executions = max_concurrent_executions;
    }
    if max_events_per_execution > 0 {
        limits.max_events_per_execution = max_events_per_execution;
    }
    if max_state_bytes > 0 {
        limits.max_state_bytes = max_state_bytes;
    }
    limits.require_controller_for_runs = require_controller_for_runs;
    limits.allowed_callers = allowed_callers;
    limits.min_cycles_reserve = min_cycles_reserve as u128;
    match ENGINE.with(|e| e.borrow_mut().set_limits(limits.clone())) {
        Ok(()) => {
            if let Err(err) = persist_current() {
                return LimitsDto::err(format!("limits set but persist failed: {err}"));
            }
            LimitsDto::from(&limits)
        }
        Err(err) => LimitsDto::err(err.to_string()),
    }
}

#[update]
async fn start_execution(execution_id: String, initial_state_json: String) -> RunReportDto {
    if let Err(err) = require_run_auth() {
        return RunReportDto::err(execution_id, err.message);
    }
    if let Err(err) = require_cycles_guard() {
        return RunReportDto::err(execution_id, err);
    }
    let started = ENGINE.with(|e| {
        e.borrow_mut()
            .start_execution(&execution_id, &initial_state_json)
    });
    let _record = match started {
        Ok(r) => r,
        Err(err) => return RunReportDto::err(execution_id, err.to_string()),
    };
    let finished = continue_effects_inner(execution_id.clone()).await;
    let _ = persist_current();
    finished
}

#[update]
async fn step(execution_id: String, max_node_steps: u32) -> RunReportDto {
    if let Err(err) = require_run_auth() {
        return RunReportDto::err(execution_id, err.message);
    }
    if let Err(err) = require_cycles_guard() {
        return RunReportDto::err(execution_id, err);
    }
    let stepped = ENGINE.with(|e| e.borrow_mut().step(&execution_id, max_node_steps));
    match stepped {
        Ok(_) => {
            let finished = continue_effects_inner(execution_id).await;
            let _ = persist_current();
            finished
        }
        Err(err) => RunReportDto::err(execution_id, err.to_string()),
    }
}

#[update]
async fn resume(execution_id: String) -> RunReportDto {
    if let Err(err) = require_run_auth() {
        return RunReportDto::err(execution_id, err.message);
    }
    if let Err(err) = require_cycles_guard() {
        return RunReportDto::err(execution_id, err);
    }
    let resumed = ENGINE.with(|e| e.borrow_mut().resume(&execution_id));
    match resumed {
        Ok(_) => {
            let finished = continue_effects_inner(execution_id).await;
            let _ = persist_current();
            finished
        }
        Err(err) => RunReportDto::err(execution_id, err.to_string()),
    }
}

#[update]
async fn continue_effects(execution_id: String) -> RunReportDto {
    if let Err(err) = require_run_auth() {
        return RunReportDto::err(execution_id, err.message);
    }
    let finished = continue_effects_inner(execution_id).await;
    let _ = persist_current();
    finished
}

/// Accept a multi-agent handoff envelope and start a local execution.
#[update]
async fn accept_handoff(
    execution_id: String,
    envelope_json: String,
    state_json: String,
    parent_authority_json: String,
) -> HandoffDto {
    if let Err(err) = require_run_auth() {
        return HandoffDto::err(err.message);
    }
    if let Err(err) = require_cycles_guard() {
        return HandoffDto::err(err);
    }
    let accepted = ENGINE.with(|e| {
        e.borrow_mut().accept_handoff(
            &execution_id,
            &envelope_json,
            &state_json,
            &parent_authority_json,
        )
    });
    match accepted {
        Ok((_record, hrecord)) => {
            // Drain effects for the new execution.
            let _ = continue_effects_inner(execution_id).await;
            let _ = persist_current();
            HandoffDto::from_record(&hrecord)
        }
        Err(err) => HandoffDto::err(err.to_string()),
    }
}

/// Forward a handoff envelope to a peer agent runtime canister.
#[update]
async fn forward_handoff(
    peer_text: String,
    execution_id: String,
    envelope_json: String,
    state_json: String,
    parent_authority_json: String,
) -> HandoffDto {
    if let Err(err) = require_run_auth() {
        return HandoffDto::err(err.message);
    }
    if let Err(err) = require_cycles_guard() {
        return HandoffDto::err(err);
    }
    let peer = match knowledge::parse_principal(&peer_text) {
        Ok(p) => p,
        Err(err) => return HandoffDto::err(err.to_string()),
    };
    // Validate locally first (fail closed before inter-canister spend).
    let validated = ENGINE.with(|e| {
        let eng = e.borrow();
        let def = eng
            .definition
            .as_ref()
            .ok_or_else(|| knolo_agent_core::CoreError::Host("no definition loaded".into()))?;
        let graph_limits = &def.compiled.definition().limits;
        let pack_auth = handoff::authority_from_pack(
            def.bundle.pack.as_ref(),
            graph_limits.max_steps,
            graph_limits.max_cost_micros,
        );
        let parent = handoff::parse_authority(&parent_authority_json)?;
        handoff::parse_and_validate_envelope(&envelope_json, &parent, &pack_auth, &eng.limits)
    });
    if let Err(err) = validated {
        return HandoffDto::err(err.to_string());
    }

    match handoff::forward_to_peer(
        peer,
        execution_id.clone(),
        envelope_json,
        state_json,
        parent_authority_json,
    )
    .await
    {
        Ok(dto) => {
            let hrecord = HandoffRecordV1 {
                version: 1,
                handoff_id: format!("forward-{execution_id}"),
                execution_id,
                destination: dto.destination.clone(),
                return_contract: String::new(),
                parent_authority: Default::default(),
                child_authority: Default::default(),
                status: "forwarded".into(),
                peer_canister: Some(peer_text),
                message: dto.message.clone(),
            };
            ENGINE.with(|e| {
                e.borrow_mut()
                    .handoffs
                    .insert(hrecord.handoff_id.clone(), hrecord);
            });
            let _ = persist_current();
            dto
        }
        Err(err) => HandoffDto::err(err.to_string()),
    }
}

#[query]
fn get_handoff(handoff_id: String) -> HandoffDto {
    ENGINE.with(|e| match e.borrow().handoffs.get(&handoff_id) {
        Some(r) => HandoffDto::from_record(r),
        None => HandoffDto::err("unknown handoff"),
    })
}

#[query]
fn get_events(execution_id: String) -> EventsDto {
    ENGINE.with(|e| {
        let eng = e.borrow();
        match eng.executions.get(&execution_id) {
            Some(record) => {
                let events_json =
                    serde_json::to_string(&record.events).unwrap_or_else(|_| "[]".into());
                EventsDto {
                    ok: true,
                    execution_id,
                    events_json,
                    message: format!("{} events", record.events.len()),
                }
            }
            None => EventsDto {
                ok: false,
                execution_id,
                events_json: "[]".into(),
                message: "unknown execution".into(),
            },
        }
    })
}

#[query]
fn get_checkpoint(execution_id: String) -> CheckpointDto {
    ENGINE.with(|e| {
        let eng = e.borrow();
        match eng.executions.get(&execution_id) {
            Some(record) => match &record.last_checkpoint {
                Some(cp) => CheckpointDto {
                    ok: true,
                    execution_id,
                    present: true,
                    checkpoint_json: serde_json::to_string(cp).unwrap_or_else(|_| "{}".into()),
                    message: "checkpoint present".into(),
                },
                None => CheckpointDto {
                    ok: true,
                    execution_id,
                    present: false,
                    checkpoint_json: "null".into(),
                    message: "no checkpoint stored for this execution".into(),
                },
            },
            None => CheckpointDto {
                ok: false,
                execution_id,
                present: false,
                checkpoint_json: "null".into(),
                message: "unknown execution".into(),
            },
        }
    })
}

// --- Effect loop + timers ----------------------------------------------------

async fn continue_effects_inner(execution_id: String) -> RunReportDto {
    loop {
        let snapshot = ENGINE.with(|e| e.borrow().executions.get(&execution_id).cloned());
        let Some(current) = snapshot else {
            return RunReportDto::err(execution_id, "unknown execution");
        };
        if current.status_kind != "suspended" {
            return RunReportDto::from(&current);
        }
        if current.status_detail == "hitl_approval" {
            return RunReportDto::from(&current);
        }

        if current.status_detail == "step_slice" {
            let (auto, delay) = ENGINE.with(|e| {
                e.borrow()
                    .definition
                    .as_ref()
                    .map(|d| (d.bundle.host.auto_continue, d.bundle.host.timer_ns))
                    .unwrap_or((false, 0))
            });
            if auto && !current.timer_scheduled {
                ENGINE.with(|e| {
                    if let Some(r) = e.borrow_mut().executions.get_mut(&execution_id) {
                        r.timer_scheduled = true;
                    }
                });
                effects::schedule_auto_continue(execution_id.clone(), delay);
                let updated = ENGINE.with(|e| {
                    e.borrow()
                        .executions
                        .get(&execution_id)
                        .cloned()
                        .expect("execution")
                });
                return RunReportDto::from(&updated);
            }
        }

        let resolved = ENGINE.with(|e| std::mem::take(&mut *e.borrow_mut()));
        let mut eng = resolved;
        let result = effects::resolve_one_effect(&mut eng, &execution_id).await;
        ENGINE.with(|e| *e.borrow_mut() = eng);
        match result {
            Ok(Some(_)) => continue,
            Ok(None) => {
                let current = ENGINE.with(|e| {
                    e.borrow()
                        .executions
                        .get(&execution_id)
                        .cloned()
                        .expect("execution")
                });
                return RunReportDto::from(&current);
            }
            Err(err) => return RunReportDto::err(execution_id, err.to_string()),
        }
    }
}

/// Invoked by timer callback (wasm).
pub async fn timer_continue_execution(execution_id: String) -> RunReportDto {
    let stepped = ENGINE.with(|e| {
        if let Some(r) = e.borrow_mut().executions.get_mut(&execution_id) {
            r.timer_scheduled = false;
        }
        e.borrow_mut().step(&execution_id, 1)
    });
    match stepped {
        Ok(_) => {
            let finished = continue_effects_inner(execution_id).await;
            let _ = persist_current();
            finished
        }
        Err(err) => RunReportDto::err(execution_id, err.to_string()),
    }
}

// --- Persistence (ic-stable-structures) --------------------------------------

#[pre_upgrade]
fn pre_upgrade() {
    // Data already lives in stable structures; flush RAM view once more.
    if let Err(err) = persist_current() {
        ic_cdk::trap(&format!("pre_upgrade persist failed: {err}"));
    }
}

#[post_upgrade]
fn post_upgrade() {
    if let Err(err) = restore_from_stable() {
        ic_cdk::trap(&format!("post_upgrade restore failed: {err}"));
    }
}

fn persist_current() -> Result<(), String> {
    let snap = ENGINE.with(|e| {
        let eng = e.borrow();
        stable_store::StableEngineSnapshot {
            schema_version: stable_store::STABLE_SCHEMA_VERSION,
            definition_json: eng.definition.as_ref().map(|d| d.definition_json.clone()),
            pack_meta: eng.pack_meta.clone(),
            executions: eng.executions.clone(),
            budget: eng.budget.snapshot.clone(),
            limits: eng.limits.clone(),
            handoffs: eng.handoffs.clone(),
        }
    });
    stable_store::persist_snapshot(&snap)
}

fn restore_from_stable() -> Result<(), String> {
    let snap = stable_store::load_snapshot()?;
    ENGINE.with(|e| {
        let mut eng = e.borrow_mut();
        *eng = Engine::default();
        eng.limits = snap.limits;
        eng.budget.snapshot = snap.budget;
        eng.handoffs = snap.handoffs;
        eng.pack_meta = snap.pack_meta;
        if let Some(json) = snap.definition_json {
            eng.load_definition(&json)
                .map_err(|err| format!("reload definition: {err}"))?;
            // load_definition clears executions; restore after.
        }
        eng.executions = snap.executions;
        // Rebuild in-memory checkpoint store from records.
        let checkpoints: Vec<_> = eng
            .executions
            .iter()
            .filter_map(|(id, record)| {
                record
                    .last_checkpoint
                    .as_ref()
                    .map(|cp| (id.clone(), cp.clone()))
            })
            .collect();
        for (id, cp) in checkpoints {
            eng.store
                .save(&cp)
                .map_err(|err| format!("restore checkpoint {id}: {err}"))?;
        }
        Ok(())
    })
}

fn require_controller() -> Result<(), HealthDto> {
    let principal = caller();
    auth::require_controller(principal, is_controller(&principal))
}

fn require_run_auth() -> Result<(), HealthDto> {
    let principal = caller();
    let limits = ENGINE.with(|e| e.borrow().limits.clone());
    auth::require_run_access(principal, is_controller(&principal), &limits)
}

fn require_cycles_guard() -> Result<(), String> {
    let limits = ENGINE.with(|e| e.borrow().limits.clone());
    let balance = {
        #[cfg(target_arch = "wasm32")]
        {
            Some(ic_cdk::api::canister_balance128())
        }
        #[cfg(not(target_arch = "wasm32"))]
        {
            None
        }
    };
    auth::require_cycles_reserve(balance, &limits)
}

// --- Native unit tests -------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;
    use knolo_agent_core::event::EventKindV1;
    use knolo_agent_core::handoff::AuthorityV1;
    use serde_json::json;
    use std::collections::BTreeSet;

    fn portable_definition() -> String {
        json!({
            "version": 1,
            "implementation_id": "portable-counter-v1",
            "pack_hash": "pack-none",
            "policy_hash": "policy-none",
            "contract_hash": "contract-none",
            "graph": {
                "version": 1,
                "id": "portable-counter",
                "state_schema": "counter-state",
                "entry": "increment",
                "nodes": [
                    { "id": "increment", "terminal": false, "reads": ["/count"], "writes": ["/count"] },
                    { "id": "done", "terminal": true, "reads": ["/count"], "writes": [] }
                ],
                "transitions": [
                    { "id": "increment.continue.done", "from": "increment", "route": "continue", "to": "done" }
                ],
                "cycles": [],
                "limits": { "max_steps": 10, "max_tokens": 100, "max_cost_micros": 1000, "timeout_ms": 30000 }
            },
            "schema": {
                "version": 1,
                "id": "counter-state",
                "paths": { "/count": "Number" },
                "required": ["/count"]
            }
        })
        .to_string()
    }

    fn host_effects_definition() -> String {
        let pack = permissive_tools_pack(false);
        json!({
            "version": 1,
            "implementation_id": "host-effects-v1",
            "pack": pack,
            "host": {
                "auto_continue": false,
                "llm_enabled": true,
                "llm_model": "llama3.1:8b",
                "knowledge_canister": null,
                "allow_https_tools": false,
                "max_effect_rounds": 8
            },
            "graph": {
                "version": 1,
                "id": "host-effects",
                "state_schema": "effects-state",
                "entry": "prepare",
                "nodes": [
                    { "id": "prepare", "terminal": false, "reads": ["/phase"], "writes": ["/phase"] },
                    { "id": "llm", "terminal": false, "reads": ["/prompt", "/phase"], "writes": ["/phase", "/llm_result"] },
                    { "id": "tool", "terminal": false, "reads": ["/tool_id", "/tool_args", "/phase"], "writes": ["/phase", "/tool_result"] },
                    { "id": "retrieve", "terminal": false, "reads": ["/query", "/phase"], "writes": ["/phase", "/retrieval_result"] },
                    { "id": "done", "terminal": true, "reads": ["/phase", "/llm_result", "/tool_result", "/retrieval_result"], "writes": [] }
                ],
                "transitions": [
                    { "id": "t1", "from": "prepare", "route": "continue", "to": "llm" },
                    { "id": "t2", "from": "llm", "route": "continue", "to": "tool" },
                    { "id": "t3", "from": "tool", "route": "continue", "to": "retrieve" },
                    { "id": "t4", "from": "retrieve", "route": "continue", "to": "done" }
                ],
                "cycles": [],
                "limits": { "max_steps": 20, "max_tokens": 10000, "max_cost_micros": 100000, "timeout_ms": 60000 }
            },
            "schema": {
                "version": 1,
                "id": "effects-state",
                "paths": {
                    "/phase": "String",
                    "/prompt": "String",
                    "/tool_id": "String",
                    "/tool_args": "Object",
                    "/query": "String",
                    "/llm_result": "Object",
                    "/tool_result": "Object",
                    "/retrieval_result": "Object"
                },
                "required": ["/phase", "/prompt"]
            }
        })
        .to_string()
    }

    fn ab_definition() -> String {
        json!({
            "version": 1,
            "implementation_id": "a-b-terminate-v1",
            "pack_hash": "p",
            "policy_hash": "policy",
            "contract_hash": "contracts",
            "graph": {
                "version": 1,
                "id": "g",
                "state_schema": "s",
                "entry": "a",
                "nodes": [
                    { "id": "a", "terminal": false, "reads": [], "writes": ["/n"] },
                    { "id": "b", "terminal": true, "reads": [], "writes": [] }
                ],
                "transitions": [
                    { "id": "next", "from": "a", "route": "continue", "to": "b" }
                ],
                "cycles": [],
                "limits": { "max_steps": 20, "max_tokens": 100, "max_cost_micros": 100, "timeout_ms": 100 }
            },
            "schema": {
                "version": 1,
                "id": "s",
                "paths": { "/n": "Number" },
                "required": ["/n"]
            }
        })
        .to_string()
    }

    #[test]
    fn portable_counter_runs_deterministically() {
        let mut eng = AgentEngine::default();
        eng.load_definition(&portable_definition()).unwrap();
        let state = json!({
            "schema_id": "counter-state",
            "revision": 0,
            "value": { "count": 0 },
            "provenance": null
        })
        .to_string();
        let r = eng.start_execution("run-1", &state).unwrap();
        assert_eq!(r.status_kind, "terminated");
        assert_eq!(r.steps, 2);
        assert!(r
            .events
            .windows(2)
            .all(|w| w[1].sequence == w[0].sequence + 1));
        assert!(r
            .events
            .iter()
            .any(|e| matches!(e.kind, EventKindV1::Terminated)));
    }

    #[test]
    fn host_effects_suspend_inject_and_complete() {
        let mut eng = AgentEngine::default();
        eng.load_definition(&host_effects_definition()).unwrap();
        let state = json!({
            "schema_id": "effects-state",
            "revision": 0,
            "value": {
                "phase": "init",
                "prompt": "ping",
                "tool_id": "echo",
                "tool_args": { "message": "knolo" },
                "query": "alpha"
            },
            "provenance": null
        })
        .to_string();

        let r = eng.start_execution("fx-1", &state).unwrap();
        assert_eq!(r.status_kind, "suspended");
        assert_eq!(r.status_detail, "await_llm");

        let r = eng
            .inject_effect_and_resume(
                "fx-1",
                "llm",
                json!({ "text": "mock-llm", "tokens": 4, "cost_micros": 40 }),
            )
            .unwrap();
        assert_eq!(r.status_detail, "await_tool");
        eng.budget.note_llm(4, 40);

        let tool_value = eng.run_tool_for_pending("fx-1").unwrap();
        let r = eng
            .inject_effect_and_resume("fx-1", "tool", tool_value)
            .unwrap();
        assert_eq!(r.status_detail, "await_retrieve");

        let retrieval = knowledge::mock_retrieve(&knolo_agent_core::retrieval::RetrievalQueryV1 {
            version: 1,
            text: "alpha".into(),
            limit: 5,
        });
        eng.budget.note_retrieval(5);
        let r = eng
            .inject_effect_and_resume("fx-1", "retrieve", serde_json::to_value(retrieval).unwrap())
            .unwrap();
        assert_eq!(r.status_kind, "terminated");
        assert!(eng.budget.snapshot.llm_calls >= 1);
        assert!(eng.budget.snapshot.tool_calls >= 1);
        assert!(eng.budget.snapshot.retrieval_calls >= 1);
        assert!(r.state.value.pointer("/llm_result").is_some());
        assert!(r.state.value.pointer("/tool_result").is_some());
        assert!(r.state.value.pointer("/retrieval_result").is_some());
    }

    #[test]
    fn tool_denied_without_pack_grant() {
        let mut def: serde_json::Value = serde_json::from_str(&host_effects_definition()).unwrap();
        def["pack"]["tools"] = json!([]);
        let mut eng = AgentEngine::default();
        eng.load_definition(&def.to_string()).unwrap();
        let state = json!({
            "schema_id": "effects-state",
            "revision": 0,
            "value": {
                "phase": "init",
                "prompt": "ping",
                "tool_id": "echo",
                "tool_args": { "message": "x" },
                "query": "q"
            },
            "provenance": null
        })
        .to_string();
        eng.start_execution("deny-1", &state).unwrap();
        eng.inject_effect_and_resume(
            "deny-1",
            "llm",
            json!({ "text": "ok", "tokens": 1, "cost_micros": 1 }),
        )
        .unwrap();
        let err = eng.run_tool_for_pending("deny-1").unwrap_err();
        let msg = err.to_string();
        assert!(
            msg.contains("PolicyDenied") || msg.contains("not granted") || msg.contains("tool"),
            "unexpected: {msg}"
        );
    }

    #[test]
    fn step_slice_then_resume() {
        let mut eng = AgentEngine::default();
        eng.load_definition(&ab_definition()).unwrap();
        let state = json!({
            "schema_id": "s",
            "revision": 0,
            "value": { "n": 0 },
            "provenance": null
        })
        .to_string();
        let r = start_with_budget(&mut eng, "sliced", &state, 1).unwrap();
        assert_eq!(r.status_kind, "suspended");
        assert_eq!(r.status_detail, "step_slice");
        let r2 = eng.resume("sliced").unwrap();
        assert_eq!(r2.status_kind, "terminated");
    }

    #[test]
    fn definition_size_and_schema_guards() {
        assert!(AgentDefinitionBundleV1::parse("").is_err());
    }

    #[test]
    fn concurrent_execution_limit_enforced() {
        let mut eng = AgentEngine::default();
        eng.load_definition(&portable_definition()).unwrap();
        eng.set_limits(RuntimeLimitsV1 {
            max_concurrent_executions: 1,
            ..RuntimeLimitsV1::default()
        })
        .unwrap();
        let state = json!({
            "schema_id": "counter-state",
            "revision": 0,
            "value": { "count": 0 },
            "provenance": null
        })
        .to_string();
        eng.start_execution("only-one", &state).unwrap();
        let err = eng.start_execution("second", &state).unwrap_err();
        assert!(err.to_string().contains("max concurrent"));
    }

    #[test]
    fn handoff_accept_and_reject_escalation() {
        let mut eng = AgentEngine::default();
        eng.load_definition(&portable_definition()).unwrap();
        let parent = AuthorityV1 {
            capabilities: BTreeSet::from(["echo".into()]),
            namespaces: BTreeSet::from(["tools".into()]),
            max_steps: 10,
            max_cost_micros: 1000,
        };
        let envelope = json!({
            "version": 1,
            "destination": "portable-counter",
            "state_projection": { "/count": "/count" },
            "authority_projection": {
                "capabilities": [],
                "namespaces": [],
                "max_steps": 5,
                "max_cost_micros": 100
            },
            "return_contract": "counter-return-v1"
        })
        .to_string();
        let state = json!({
            "schema_id": "counter-state",
            "revision": 0,
            "value": { "count": 0 },
            "provenance": null
        })
        .to_string();
        let parent_json = serde_json::to_string(&parent).unwrap();
        let (record, h) = eng
            .accept_handoff("handoff-run", &envelope, &state, &parent_json)
            .unwrap();
        assert_eq!(record.status_kind, "terminated");
        assert_eq!(h.status, "accepted");
        assert!(eng.handoffs.contains_key(&h.handoff_id));

        // Escalation rejected.
        let bad = json!({
            "version": 1,
            "destination": "portable-counter",
            "state_projection": {},
            "authority_projection": {
                "capabilities": ["admin"],
                "namespaces": [],
                "max_steps": 5,
                "max_cost_micros": 100
            },
            "return_contract": "x"
        })
        .to_string();
        let err = eng
            .accept_handoff("bad-handoff", &bad, &state, &parent_json)
            .unwrap_err();
        assert!(
            err.to_string().contains("escalation") || err.to_string().contains("authority"),
            "{}",
            err
        );
    }

    #[test]
    fn stable_snapshot_round_trip() {
        let mut eng = AgentEngine::default();
        eng.load_definition(&portable_definition()).unwrap();
        let state = json!({
            "schema_id": "counter-state",
            "revision": 0,
            "value": { "count": 0 },
            "provenance": null
        })
        .to_string();
        eng.start_execution("persist-me", &state).unwrap();
        let snap = stable_store::StableEngineSnapshot {
            schema_version: stable_store::STABLE_SCHEMA_VERSION,
            definition_json: eng.definition.as_ref().map(|d| d.definition_json.clone()),
            pack_meta: eng.pack_meta.clone(),
            executions: eng.executions.clone(),
            budget: eng.budget.snapshot.clone(),
            limits: eng.limits.clone(),
            handoffs: eng.handoffs.clone(),
        };
        stable_store::persist_snapshot(&snap).unwrap();
        let loaded = stable_store::load_snapshot().unwrap();
        assert!(loaded.definition_json.is_some());
        assert!(loaded.executions.contains_key("persist-me"));
        assert_eq!(loaded.schema_version, stable_store::STABLE_SCHEMA_VERSION);
    }
}
