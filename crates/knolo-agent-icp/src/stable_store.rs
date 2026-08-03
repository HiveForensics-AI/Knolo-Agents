//! Versioned stable-memory schemas via `ic-stable-structures` (Phase 3).
//!
//! Layout (MemoryManager virtual memories):
//! - 0: schema version cell
//! - 1: definition JSON cell
//! - 2: pack meta JSON cell
//! - 3: executions BTreeMap (id → ExecutionRecord JSON)
//! - 4: checkpoints BTreeMap (id → Checkpoint JSON)
//! - 5: events BTreeMap (`{id}\\x1f{seq}` → event JSON)
//! - 6: budget JSON cell
//! - 7: runtime limits JSON cell
//! - 8: handoffs BTreeMap (id → handoff record JSON)
//!
//! Hot path still uses the in-RAM `AgentEngine`; this store is the upgrade-safe
//! source of truth flushed after mutations and reloaded on upgrade.
use crate::budget::HostBudgetSnapshotV1;
use crate::engine::ExecutionRecord;
use crate::handoff::HandoffRecordV1;
use crate::limits::{PackMetaV1, RuntimeLimitsV1};
use ic_stable_structures::memory_manager::{MemoryId, MemoryManager, VirtualMemory};
use ic_stable_structures::{DefaultMemoryImpl, StableBTreeMap, StableCell};
use knolo_agent_core::checkpoint::CheckpointV1;
use knolo_agent_core::event::ExecutionEventV1;
use serde::{Deserialize, Serialize};
use std::cell::RefCell;
use std::collections::BTreeMap;

/// Current stable schema version written to memory 0.
pub const STABLE_SCHEMA_VERSION: u32 = 1;

type Memory = VirtualMemory<DefaultMemoryImpl>;

const MEM_SCHEMA: MemoryId = MemoryId::new(0);
const MEM_DEFINITION: MemoryId = MemoryId::new(1);
const MEM_PACK_META: MemoryId = MemoryId::new(2);
const MEM_EXECUTIONS: MemoryId = MemoryId::new(3);
const MEM_CHECKPOINTS: MemoryId = MemoryId::new(4);
const MEM_EVENTS: MemoryId = MemoryId::new(5);
const MEM_BUDGET: MemoryId = MemoryId::new(6);
const MEM_LIMITS: MemoryId = MemoryId::new(7);
const MEM_HANDOFFS: MemoryId = MemoryId::new(8);

thread_local! {
    static MEMORY_MANAGER: RefCell<MemoryManager<DefaultMemoryImpl>> =
        RefCell::new(MemoryManager::init(DefaultMemoryImpl::default()));

    static SCHEMA: RefCell<StableCell<u32, Memory>> = RefCell::new(
        StableCell::init(
            MEMORY_MANAGER.with(|m| m.borrow().get(MEM_SCHEMA)),
            0,
        )
        .expect("init schema cell"),
    );

    static DEFINITION: RefCell<StableCell<String, Memory>> = RefCell::new(
        StableCell::init(
            MEMORY_MANAGER.with(|m| m.borrow().get(MEM_DEFINITION)),
            String::new(),
        )
        .expect("init definition cell"),
    );

    static PACK_META: RefCell<StableCell<String, Memory>> = RefCell::new(
        StableCell::init(
            MEMORY_MANAGER.with(|m| m.borrow().get(MEM_PACK_META)),
            String::new(),
        )
        .expect("init pack meta cell"),
    );

    static EXECUTIONS: RefCell<StableBTreeMap<String, String, Memory>> = RefCell::new(
        StableBTreeMap::init(MEMORY_MANAGER.with(|m| m.borrow().get(MEM_EXECUTIONS))),
    );

    static CHECKPOINTS: RefCell<StableBTreeMap<String, String, Memory>> = RefCell::new(
        StableBTreeMap::init(MEMORY_MANAGER.with(|m| m.borrow().get(MEM_CHECKPOINTS))),
    );

    static EVENTS: RefCell<StableBTreeMap<String, String, Memory>> = RefCell::new(
        StableBTreeMap::init(MEMORY_MANAGER.with(|m| m.borrow().get(MEM_EVENTS))),
    );

    static BUDGET: RefCell<StableCell<String, Memory>> = RefCell::new(
        StableCell::init(
            MEMORY_MANAGER.with(|m| m.borrow().get(MEM_BUDGET)),
            String::new(),
        )
        .expect("init budget cell"),
    );

    static LIMITS: RefCell<StableCell<String, Memory>> = RefCell::new(
        StableCell::init(
            MEMORY_MANAGER.with(|m| m.borrow().get(MEM_LIMITS)),
            String::new(),
        )
        .expect("init limits cell"),
    );

    static HANDOFFS: RefCell<StableBTreeMap<String, String, Memory>> = RefCell::new(
        StableBTreeMap::init(MEMORY_MANAGER.with(|m| m.borrow().get(MEM_HANDOFFS))),
    );
}

/// Snapshot loaded from stable structures into RAM.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct StableEngineSnapshot {
    pub schema_version: u32,
    pub definition_json: Option<String>,
    pub pack_meta: Option<PackMetaV1>,
    pub executions: BTreeMap<String, ExecutionRecord>,
    pub budget: HostBudgetSnapshotV1,
    pub limits: RuntimeLimitsV1,
    pub handoffs: BTreeMap<String, HandoffRecordV1>,
}

fn event_key(execution_id: &str, sequence: u64) -> String {
    format!("{execution_id}\u{1f}{sequence}")
}

/// Ensure schema version is stamped; migrate when older schemas appear.
pub fn ensure_schema() -> Result<(), String> {
    SCHEMA.with(|cell| {
        let mut cell = cell.borrow_mut();
        let current = *cell.get();
        if current == 0 {
            cell.set(STABLE_SCHEMA_VERSION)
                .map_err(|e| format!("set schema version: {e:?}"))?;
            return Ok(());
        }
        if current == STABLE_SCHEMA_VERSION {
            return Ok(());
        }
        // Future: migrate current → STABLE_SCHEMA_VERSION here.
        if current > STABLE_SCHEMA_VERSION {
            return Err(format!(
                "stable schema version {current} is newer than supported {STABLE_SCHEMA_VERSION}"
            ));
        }
        // v1 is the first structured schema; nothing older than 1 uses MemoryManager.
        cell.set(STABLE_SCHEMA_VERSION)
            .map_err(|e| format!("migrate schema version: {e:?}"))?;
        Ok(())
    })
}

pub fn schema_version() -> u32 {
    SCHEMA.with(|c| *c.borrow().get())
}

pub fn persist_definition(definition_json: Option<&str>) -> Result<(), String> {
    DEFINITION.with(|cell| {
        cell.borrow_mut()
            .set(definition_json.unwrap_or("").to_owned())
            .map_err(|e| format!("persist definition: {e:?}"))
    })?;
    Ok(())
}

pub fn persist_pack_meta(meta: Option<&PackMetaV1>) -> Result<(), String> {
    let json = match meta {
        Some(m) => serde_json::to_string(m).map_err(|e| e.to_string())?,
        None => String::new(),
    };
    PACK_META.with(|cell| {
        cell.borrow_mut()
            .set(json)
            .map_err(|e| format!("persist pack meta: {e:?}"))
    })?;
    Ok(())
}

pub fn persist_budget(budget: &HostBudgetSnapshotV1) -> Result<(), String> {
    let json = serde_json::to_string(budget).map_err(|e| e.to_string())?;
    BUDGET.with(|cell| {
        cell.borrow_mut()
            .set(json)
            .map_err(|e| format!("persist budget: {e:?}"))
    })?;
    Ok(())
}

pub fn persist_limits(limits: &RuntimeLimitsV1) -> Result<(), String> {
    let json = serde_json::to_string(limits).map_err(|e| e.to_string())?;
    LIMITS.with(|cell| {
        cell.borrow_mut()
            .set(json)
            .map_err(|e| format!("persist limits: {e:?}"))
    })?;
    Ok(())
}

pub fn persist_execution(record: &ExecutionRecord) -> Result<(), String> {
    let id = &record.execution_id;
    let json = serde_json::to_string(record).map_err(|e| e.to_string())?;
    EXECUTIONS.with(|map| {
        map.borrow_mut().insert(id.clone(), json);
    });

    // Explicit checkpoint map for upgrade-safe direct load.
    if let Some(cp) = &record.last_checkpoint {
        let cp_json = serde_json::to_string(cp).map_err(|e| e.to_string())?;
        CHECKPOINTS.with(|map| {
            map.borrow_mut().insert(id.clone(), cp_json);
        });
    }

    // Versioned event log entries (keyed by execution + sequence).
    EVENTS.with(|map| {
        let mut map = map.borrow_mut();
        // Drop prior events for this execution then rewrite (simple, correct).
        let prefix = format!("{id}\u{1f}");
        let stale: Vec<String> = map
            .iter()
            .filter_map(|(k, _)| {
                if k.starts_with(&prefix) {
                    Some(k)
                } else {
                    None
                }
            })
            .collect();
        for k in stale {
            map.remove(&k);
        }
        for ev in &record.events {
            if let Ok(ej) = serde_json::to_string(ev) {
                map.insert(event_key(id, ev.sequence), ej);
            }
        }
    });
    Ok(())
}

#[allow(dead_code)]
pub fn remove_execution(execution_id: &str) -> Result<(), String> {
    EXECUTIONS.with(|map| {
        map.borrow_mut().remove(&execution_id.to_owned());
    });
    CHECKPOINTS.with(|map| {
        map.borrow_mut().remove(&execution_id.to_owned());
    });
    EVENTS.with(|map| {
        let mut map = map.borrow_mut();
        let prefix = format!("{execution_id}\u{1f}");
        let stale: Vec<String> = map
            .iter()
            .filter_map(|(k, _)| {
                if k.starts_with(&prefix) {
                    Some(k)
                } else {
                    None
                }
            })
            .collect();
        for k in stale {
            map.remove(&k);
        }
    });
    Ok(())
}

pub fn clear_all_executions() -> Result<(), String> {
    EXECUTIONS.with(|map| {
        let keys: Vec<String> = map.borrow().iter().map(|(k, _)| k).collect();
        let mut map = map.borrow_mut();
        for k in keys {
            map.remove(&k);
        }
    });
    CHECKPOINTS.with(|map| {
        let keys: Vec<String> = map.borrow().iter().map(|(k, _)| k).collect();
        let mut map = map.borrow_mut();
        for k in keys {
            map.remove(&k);
        }
    });
    EVENTS.with(|map| {
        let keys: Vec<String> = map.borrow().iter().map(|(k, _)| k).collect();
        let mut map = map.borrow_mut();
        for k in keys {
            map.remove(&k);
        }
    });
    Ok(())
}

pub fn persist_handoff(record: &HandoffRecordV1) -> Result<(), String> {
    let json = serde_json::to_string(record).map_err(|e| e.to_string())?;
    HANDOFFS.with(|map| {
        map.borrow_mut().insert(record.handoff_id.clone(), json);
    });
    Ok(())
}

pub fn clear_handoffs() -> Result<(), String> {
    HANDOFFS.with(|map| {
        let keys: Vec<String> = map.borrow().iter().map(|(k, _)| k).collect();
        let mut map = map.borrow_mut();
        for k in keys {
            map.remove(&k);
        }
    });
    Ok(())
}

/// Persist the full engine-facing snapshot (definition, packs, runs, budget, limits, handoffs).
pub fn persist_snapshot(snap: &StableEngineSnapshot) -> Result<(), String> {
    ensure_schema()?;
    SCHEMA.with(|cell| {
        cell.borrow_mut()
            .set(STABLE_SCHEMA_VERSION)
            .map_err(|e| format!("stamp schema: {e:?}"))
    })?;
    persist_definition(snap.definition_json.as_deref())?;
    persist_pack_meta(snap.pack_meta.as_ref())?;
    persist_budget(&snap.budget)?;
    persist_limits(&snap.limits)?;

    // Replace execution maps entirely for consistency.
    clear_all_executions()?;
    for record in snap.executions.values() {
        persist_execution(record)?;
    }

    clear_handoffs()?;
    for h in snap.handoffs.values() {
        persist_handoff(h)?;
    }
    Ok(())
}

pub fn load_snapshot() -> Result<StableEngineSnapshot, String> {
    ensure_schema()?;
    let schema_version = schema_version();
    let definition_json = DEFINITION.with(|c| {
        let s = c.borrow().get().clone();
        if s.is_empty() {
            None
        } else {
            Some(s)
        }
    });
    let pack_meta = PACK_META.with(|c| {
        let s = c.borrow().get().clone();
        if s.is_empty() {
            None
        } else {
            serde_json::from_str(&s).ok()
        }
    });
    let budget = BUDGET.with(|c| {
        let s = c.borrow().get().clone();
        if s.is_empty() {
            HostBudgetSnapshotV1::default()
        } else {
            serde_json::from_str(&s).unwrap_or_default()
        }
    });
    let limits = LIMITS.with(|c| {
        let s = c.borrow().get().clone();
        if s.is_empty() {
            RuntimeLimitsV1::default()
        } else {
            serde_json::from_str(&s).unwrap_or_default()
        }
    });

    let mut executions = BTreeMap::new();
    EXECUTIONS.with(|map| {
        for (id, json) in map.borrow().iter() {
            if let Ok(mut record) = serde_json::from_str::<ExecutionRecord>(&json) {
                // Prefer explicit event map if present (authoritative ordered log).
                let mut from_map: Vec<ExecutionEventV1> = Vec::new();
                EVENTS.with(|ev| {
                    let prefix = format!("{id}\u{1f}");
                    for (k, ej) in ev.borrow().iter() {
                        if k.starts_with(&prefix) {
                            if let Ok(e) = serde_json::from_str::<ExecutionEventV1>(&ej) {
                                from_map.push(e);
                            }
                        }
                    }
                });
                if !from_map.is_empty() {
                    from_map.sort_by_key(|e| e.sequence);
                    record.events = from_map;
                }
                // Prefer explicit checkpoint map.
                CHECKPOINTS.with(|cp| {
                    if let Some(cj) = cp.borrow().get(&id) {
                        if let Ok(checkpoint) = serde_json::from_str::<CheckpointV1>(&cj) {
                            record.last_checkpoint = Some(checkpoint);
                        }
                    }
                });
                executions.insert(id, record);
            }
        }
    });

    let mut handoffs = BTreeMap::new();
    HANDOFFS.with(|map| {
        for (id, json) in map.borrow().iter() {
            if let Ok(h) = serde_json::from_str::<HandoffRecordV1>(&json) {
                handoffs.insert(id, h);
            }
        }
    });

    Ok(StableEngineSnapshot {
        schema_version,
        definition_json,
        pack_meta,
        executions,
        budget,
        limits,
        handoffs,
    })
}

/// Stats for inspect / ops.
pub fn store_stats() -> StoreStats {
    StoreStats {
        schema_version: schema_version(),
        execution_count: EXECUTIONS.with(|m| m.borrow().len()),
        checkpoint_count: CHECKPOINTS.with(|m| m.borrow().len()),
        event_entry_count: EVENTS.with(|m| m.borrow().len()),
        handoff_count: HANDOFFS.with(|m| m.borrow().len()),
        has_definition: DEFINITION.with(|c| !c.borrow().get().is_empty()),
    }
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq, Eq)]
pub struct StoreStats {
    pub schema_version: u32,
    pub execution_count: u64,
    pub checkpoint_count: u64,
    pub event_entry_count: u64,
    pub handoff_count: u64,
    pub has_definition: bool,
}

#[cfg(test)]
mod tests {
    use super::*;
    use knolo_agent_core::state::StateSnapshot;
    use serde_json::json;

    #[test]
    fn round_trip_execution_and_events() {
        use std::str::FromStr;
        ensure_schema().unwrap();
        let record = ExecutionRecord {
            execution_id: "rt-1".into(),
            status_kind: "terminated".into(),
            status_detail: "null".into(),
            steps: 2,
            tokens: 0,
            cost_micros: 0,
            state: StateSnapshot {
                schema_id: knolo_agent_core::StateSchemaId::from_str("s").unwrap(),
                revision: 1,
                value: json!({ "n": 1 }),
                provenance: None,
            },
            events: vec![],
            last_checkpoint: None,
            pending_resume: None,
            effect_cache: BTreeMap::new(),
            timer_scheduled: false,
            handoff_id: None,
        };
        persist_execution(&record).unwrap();
        let snap = load_snapshot().unwrap();
        assert!(snap.executions.contains_key("rt-1"));
        remove_execution("rt-1").unwrap();
    }

    #[test]
    fn limits_and_budget_cells() {
        let limits = RuntimeLimitsV1 {
            max_concurrent_executions: 4,
            ..RuntimeLimitsV1::default()
        };
        persist_limits(&limits).unwrap();
        let budget = HostBudgetSnapshotV1 {
            tool_calls: 3,
            ..HostBudgetSnapshotV1::default()
        };
        persist_budget(&budget).unwrap();
        let snap = load_snapshot().unwrap();
        assert_eq!(snap.limits.max_concurrent_executions, 4);
        assert_eq!(snap.budget.tool_calls, 3);
    }
}
