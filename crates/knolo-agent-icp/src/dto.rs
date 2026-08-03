//! Candid DTOs for the agent runtime canister surface.
use crate::budget::HostBudgetSnapshotV1;
use crate::engine::ExecutionRecord;
use candid::CandidType;
use serde::Deserialize;

#[derive(CandidType, Deserialize, Clone, Debug, PartialEq, Eq)]
pub struct HealthDto {
    pub ok: bool,
    pub message: String,
}

#[derive(CandidType, Deserialize, Clone, Debug, PartialEq, Eq)]
pub struct InspectionDto {
    pub ok: bool,
    pub engine: String,
    pub graph_loaded: bool,
    pub graph_id: Option<String>,
    pub graph_hash: Option<String>,
    pub implementation_id: Option<String>,
    pub execution_count: u64,
    pub capabilities: Vec<String>,
    pub limitations: Vec<String>,
    pub message: String,
}

#[derive(CandidType, Deserialize, Clone, Debug, PartialEq, Eq)]
pub struct StatusDto {
    pub kind: String,
    pub detail: String,
}

#[derive(CandidType, Deserialize, Clone, Debug, PartialEq, Eq)]
pub struct RunReportDto {
    pub ok: bool,
    pub execution_id: String,
    pub status: StatusDto,
    pub steps: u64,
    pub tokens: u64,
    pub cost_micros: u64,
    pub state_json: String,
    pub event_count: u64,
    pub message: String,
}

#[derive(CandidType, Deserialize, Clone, Debug, PartialEq, Eq)]
pub struct EventsDto {
    pub ok: bool,
    pub execution_id: String,
    pub events_json: String,
    pub message: String,
}

#[derive(CandidType, Deserialize, Clone, Debug, PartialEq, Eq)]
pub struct CheckpointDto {
    pub ok: bool,
    pub execution_id: String,
    pub present: bool,
    pub checkpoint_json: String,
    pub message: String,
}

#[derive(CandidType, Deserialize, Clone, Debug, PartialEq, Eq)]
pub struct BudgetDto {
    pub ok: bool,
    pub tool_calls: u64,
    pub tool_units: u64,
    pub llm_calls: u64,
    pub retrieval_calls: u64,
    pub effect_rounds: u64,
    pub knolo_steps: u64,
    pub knolo_tokens: u64,
    pub knolo_cost_micros: u64,
    pub cycles_spent_observed: u64,
    pub last_cycles_balance: Option<u64>,
    pub message: String,
}

impl HealthDto {
    pub fn ok(message: impl Into<String>) -> Self {
        Self {
            ok: true,
            message: message.into(),
        }
    }
    pub fn err(message: impl Into<String>) -> Self {
        Self {
            ok: false,
            message: message.into(),
        }
    }
}

impl From<&ExecutionRecord> for RunReportDto {
    fn from(r: &ExecutionRecord) -> Self {
        let state_json = serde_json::to_string(&r.state).unwrap_or_else(|_| "{}".into());
        Self {
            ok: r.status_kind != "failed",
            execution_id: r.execution_id.clone(),
            status: StatusDto {
                kind: r.status_kind.clone(),
                detail: r.status_detail.clone(),
            },
            steps: r.steps,
            tokens: r.tokens,
            cost_micros: r.cost_micros,
            state_json,
            event_count: r.events.len() as u64,
            message: format!("status={}", r.status_kind),
        }
    }
}

impl RunReportDto {
    pub fn err(execution_id: impl Into<String>, message: impl Into<String>) -> Self {
        Self {
            ok: false,
            execution_id: execution_id.into(),
            status: StatusDto {
                kind: "error".into(),
                detail: String::new(),
            },
            steps: 0,
            tokens: 0,
            cost_micros: 0,
            state_json: "{}".into(),
            event_count: 0,
            message: message.into(),
        }
    }
}

impl From<&HostBudgetSnapshotV1> for BudgetDto {
    fn from(s: &HostBudgetSnapshotV1) -> Self {
        Self {
            ok: true,
            tool_calls: s.tool_calls,
            tool_units: s.tool_units,
            llm_calls: s.llm_calls,
            retrieval_calls: s.retrieval_calls,
            effect_rounds: s.effect_rounds,
            knolo_steps: s.knolo_steps,
            knolo_tokens: s.knolo_tokens,
            knolo_cost_micros: s.knolo_cost_micros,
            cycles_spent_observed: s.cycles_spent_observed.min(u64::MAX as u128) as u64,
            last_cycles_balance: s
                .last_cycles_balance
                .map(|v| v.min(u64::MAX as u128) as u64),
            message: "budget snapshot".into(),
        }
    }
}
