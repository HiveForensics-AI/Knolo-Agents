//! ICP canister host for the Knolo agent control plane (Phase 1 + Phase 2).
//!
//! Phase 1: pure deterministic graphs, checkpoints, ordered events.
//! Phase 2: pack-gated tools, ic-llm, knowledge retrieval, timers, cycles budget.
mod budget;
mod definition;
mod dto;
mod effects;
mod engine;
mod executor;
mod host;
mod knowledge;
mod tools_host;

pub use definition::{
    AgentDefinitionBundleV1, HostConfigV1, LoadedDefinition, MAX_DEFINITION_BYTES,
};
pub use dto::*;
pub use engine::{start_with_budget, AgentEngine, ExecutionRecord};
pub use executor::DeterministicExecutor;
pub use host::{fixed_clock, DETERMINISTIC_NOW_MS};
pub use tools_host::permissive_tools_pack;

use candid::CandidType;
use engine::AgentEngine as Engine;
use ic_cdk::api::{caller, is_controller};
use ic_cdk::storage::{stable_restore, stable_save};
use ic_cdk_macros::{post_upgrade, pre_upgrade, query, update};
use serde::{Deserialize, Serialize};
use std::cell::RefCell;

thread_local! {
    static ENGINE: RefCell<Engine> = RefCell::new(Engine::default());
}

#[derive(CandidType, Deserialize, Serialize, Clone, Debug, Default)]
struct StableSnapshot {
    definition_json: Option<String>,
    executions_json: String,
    /// Added in Phase 2; optional for upgrade from Phase 1 snapshots.
    #[serde(default)]
    budget_json: String,
}

// --- Candid surface ----------------------------------------------------------

#[query]
fn health() -> HealthDto {
    ENGINE.with(|e| {
        let eng = e.borrow();
        if eng.definition.is_some() {
            HealthDto::ok("Agent runtime ready (definition loaded). Phase 2 effects enabled.")
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
                        "in-memory checkpoints until phase 3 stable structures".into(),
                    ],
                    message: "Phase 2: host effects + packs on ICP.".into(),
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
            },
        }
    })
}

#[query]
fn get_budget() -> BudgetDto {
    ENGINE.with(|e| BudgetDto::from(&e.borrow().budget.snapshot))
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
async fn start_execution(execution_id: String, initial_state_json: String) -> RunReportDto {
    let started = ENGINE.with(|e| {
        e.borrow_mut()
            .start_execution(&execution_id, &initial_state_json)
    });
    let record = match started {
        Ok(r) => r,
        Err(err) => return RunReportDto::err(execution_id, err.to_string()),
    };
    let _ = record;
    let finished = continue_effects_inner(execution_id.clone()).await;
    let _ = persist_current();
    finished
}

#[update]
async fn step(execution_id: String, max_node_steps: u32) -> RunReportDto {
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
    let finished = continue_effects_inner(execution_id).await;
    let _ = persist_current();
    finished
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
    // Drive automatic effects outside RefCell borrow across awaits.
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

        let resolved = ENGINE.with(|e| {
            // Cannot await inside with — use take pattern
            std::mem::take(&mut *e.borrow_mut())
        });
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

// --- Persistence -------------------------------------------------------------

#[pre_upgrade]
fn pre_upgrade() {
    if let Err(err) = persist_current() {
        ic_cdk::trap(&format!("pre_upgrade persist failed: {err}"));
    }
}

#[post_upgrade]
fn post_upgrade() {
    let snapshot: StableSnapshot = match load_snapshot() {
        Ok(s) => s,
        Err(err) => ic_cdk::trap(&format!("post_upgrade load failed: {err}")),
    };
    if let Err(err) = restore_engine(snapshot) {
        ic_cdk::trap(&format!("post_upgrade restore failed: {err}"));
    }
}

fn persist_current() -> Result<(), String> {
    let snapshot = ENGINE.with(|e| {
        let eng = e.borrow();
        StableSnapshot {
            definition_json: eng.definition.as_ref().map(|d| d.definition_json.clone()),
            executions_json: serde_json::to_string(&eng.executions).unwrap_or_else(|_| "{}".into()),
            budget_json: serde_json::to_string(&eng.budget.snapshot)
                .unwrap_or_else(|_| "{}".into()),
        }
    });
    stable_save((snapshot,)).map_err(|e| format!("stable_save: {e}"))
}

fn load_snapshot() -> Result<StableSnapshot, String> {
    stable_restore::<(StableSnapshot,)>()
        .map(|(s,)| s)
        .map_err(|e| format!("stable_restore: {e}"))
}

fn restore_engine(snapshot: StableSnapshot) -> Result<(), String> {
    ENGINE.with(|e| {
        let mut eng = e.borrow_mut();
        *eng = Engine::default();
        if let Some(json) = snapshot.definition_json {
            eng.load_definition(&json)
                .map_err(|err| format!("reload definition: {err}"))?;
        }
        if !snapshot.executions_json.is_empty() && snapshot.executions_json != "{}" {
            let map: std::collections::BTreeMap<String, ExecutionRecord> =
                serde_json::from_str(&snapshot.executions_json)
                    .map_err(|err| format!("decode executions: {err}"))?;
            eng.executions = map;
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
                use knolo_agent_core::node::CheckpointStore;
                eng.store
                    .save(&cp)
                    .map_err(|err| format!("restore checkpoint {id}: {err}"))?;
            }
        }
        if !snapshot.budget_json.is_empty() && snapshot.budget_json != "{}" {
            if let Ok(snap) = serde_json::from_str(&snapshot.budget_json) {
                eng.budget.snapshot = snap;
            }
        }
        Ok(())
    })
}

fn require_controller() -> Result<(), HealthDto> {
    let principal = caller();
    if is_controller(&principal) {
        Ok(())
    } else {
        Err(HealthDto::err(format!(
            "Unauthorized: caller {principal} is not a controller of this canister."
        )))
    }
}

// --- Native unit tests -------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;
    use knolo_agent_core::event::EventKindV1;
    use serde_json::json;

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

        // Inject LLM, tool (pack-gated), and retrieval results — same path as async host.
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
        // Empty tools set with zero budget is invalid; use pack that doesn't include echo.
        def["pack"]["tools"] = json!([]);
        // compile requires max_calls > 0 still
        let mut eng = AgentEngine::default();
        // pack with no tools will fail compile if max_calls ok but tools empty is fine
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
        // inject llm to reach tool
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
}
