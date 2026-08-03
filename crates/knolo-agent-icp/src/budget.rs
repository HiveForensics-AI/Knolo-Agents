//! Knolo budget ledger + cycles observation for the ICP host.
use knolo_agent::policy::BudgetLedger;
use knolo_agent_core::pack::CompiledPolicyV1;
use serde::{Deserialize, Serialize};

/// Dual view: Knolo resource usage + optional cycles observations.
#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq, Eq)]
pub struct HostBudgetSnapshotV1 {
    pub tool_calls: u64,
    pub tool_units: u64,
    pub tool_duration_ms: u64,
    pub llm_calls: u64,
    pub retrieval_calls: u64,
    pub effect_rounds: u64,
    /// Cycles observed at last effect boundary (when available).
    pub last_cycles_balance: Option<u128>,
    /// Sum of measured cycle deltas across effect calls (best-effort).
    pub cycles_spent_observed: u128,
    pub knolo_cost_micros: u64,
    pub knolo_tokens: u64,
    pub knolo_steps: u64,
}

#[derive(Debug, Default)]
pub struct HostBudgetTracker {
    pub ledger: BudgetLedger,
    pub snapshot: HostBudgetSnapshotV1,
}

impl HostBudgetTracker {
    pub fn note_llm(&mut self, tokens: u64, cost_micros: u64) {
        self.snapshot.llm_calls = self.snapshot.llm_calls.saturating_add(1);
        self.snapshot.knolo_tokens = self.snapshot.knolo_tokens.saturating_add(tokens);
        self.snapshot.knolo_cost_micros =
            self.snapshot.knolo_cost_micros.saturating_add(cost_micros);
    }

    pub fn note_retrieval(&mut self, cost_micros: u64) {
        self.snapshot.retrieval_calls = self.snapshot.retrieval_calls.saturating_add(1);
        self.snapshot.knolo_cost_micros =
            self.snapshot.knolo_cost_micros.saturating_add(cost_micros);
    }

    pub fn note_tool_usage(&mut self, calls: u64, units: u64, duration_ms: u64) {
        self.snapshot.tool_calls = self.snapshot.tool_calls.saturating_add(calls);
        self.snapshot.tool_units = self.snapshot.tool_units.saturating_add(units);
        self.snapshot.tool_duration_ms = self.snapshot.tool_duration_ms.saturating_add(duration_ms);
    }

    pub fn note_effect_round(&mut self) {
        self.snapshot.effect_rounds = self.snapshot.effect_rounds.saturating_add(1);
    }

    pub fn note_cycles_delta(&mut self, before: u128, after: u128) {
        self.snapshot.last_cycles_balance = Some(after);
        if before >= after {
            self.snapshot.cycles_spent_observed = self
                .snapshot
                .cycles_spent_observed
                .saturating_add(before - after);
        }
    }

    pub fn sync_run_totals(&mut self, steps: u64, tokens: u64, cost_micros: u64) {
        self.snapshot.knolo_steps = steps;
        // Prefer max so effect notes are not wiped by lower scheduler totals.
        self.snapshot.knolo_tokens = self.snapshot.knolo_tokens.max(tokens);
        self.snapshot.knolo_cost_micros = self.snapshot.knolo_cost_micros.max(cost_micros);
    }

    pub fn policy_budget_exhausted(&self, policy: Option<&CompiledPolicyV1>) -> bool {
        let Some(p) = policy else {
            return false;
        };
        let b = p.budget();
        self.snapshot.tool_calls >= b.max_calls
            || self.snapshot.tool_units > b.max_units
            || self.snapshot.tool_duration_ms > b.max_duration_ms
    }
}
