//! Async host effect resolution (LLM, tools, retrieval, timers).
use crate::engine::{AgentEngine, ExecutionRecord};
use crate::knowledge::{mock_retrieve, parse_principal, retrieve_from_canister};
use knolo_agent_core::{retrieval::RetrievalQueryV1, CoreError};
use serde_json::{json, Value};

/// Resolve a single pending host effect if the execution is suspended for one.
pub async fn resolve_one_effect(
    engine: &mut AgentEngine,
    execution_id: &str,
) -> Result<Option<ExecutionRecord>, CoreError> {
    let status = engine
        .executions
        .get(execution_id)
        .map(|r| {
            (
                r.status_kind.clone(),
                r.status_detail.clone(),
                r.state.clone(),
            )
        })
        .ok_or_else(|| CoreError::Host(format!("unknown execution '{execution_id}'")))?;

    if status.0 != "suspended" {
        return Ok(None);
    }

    engine.budget.note_effect_round();
    let before = cycles_balance();

    let record = match status.1.as_str() {
        "await_llm" => {
            let prompt = status
                .2
                .value
                .pointer("/prompt")
                .and_then(Value::as_str)
                .unwrap_or("Say hello from Knolo ICP agent.")
                .to_string();
            let (text, tokens, cost) = llm_prompt(&prompt).await?;
            engine.budget.note_llm(tokens, cost);
            let value = json!({
                "text": text,
                "tokens": tokens,
                "cost_micros": cost,
                "provider": "ic-llm",
            });
            engine.inject_effect_and_resume(execution_id, "llm", value)?
        }
        "await_tool" => {
            let value = engine.run_tool_for_pending(execution_id)?;
            engine.inject_effect_and_resume(execution_id, "tool", value)?
        }
        "await_retrieve" => {
            let q_text = status
                .2
                .value
                .pointer("/query")
                .and_then(Value::as_str)
                .unwrap_or("alpha")
                .to_string();
            let limit = status
                .2
                .value
                .pointer("/limit")
                .and_then(Value::as_u64)
                .unwrap_or(5) as u32;
            let query = RetrievalQueryV1 {
                version: 1,
                text: q_text,
                limit,
            };
            let result = match engine
                .definition
                .as_ref()
                .and_then(|d| d.bundle.host.knowledge_canister.as_ref())
            {
                Some(p) if !p.is_empty() => {
                    let principal = parse_principal(p)?;
                    retrieve_from_canister(principal, &query).await?
                }
                _ => mock_retrieve(&query),
            };
            engine.budget.note_retrieval(5);
            let value = serde_json::to_value(&result)
                .map_err(|e| CoreError::Host(format!("serialize retrieval: {e}")))?;
            engine.inject_effect_and_resume(execution_id, "retrieve", value)?
        }
        "step_slice" => {
            // Timer path schedules externally; here we just resume one more slice.
            engine.step(execution_id, 1)?
        }
        _ => return Ok(None),
    };

    let after = cycles_balance();
    if let (Some(b), Some(a)) = (before, after) {
        engine.budget.note_cycles_delta(b, a);
    }
    Ok(Some(record))
}

/// Drain automatic host effects until terminal, HITL, max rounds, or step_slice with timer.
#[allow(dead_code)]
pub async fn resolve_effects_loop(
    engine: &mut AgentEngine,
    execution_id: &str,
) -> Result<ExecutionRecord, CoreError> {
    let max_rounds = engine
        .definition
        .as_ref()
        .map(|d| d.bundle.host.max_effect_rounds)
        .unwrap_or(8);

    for _ in 0..max_rounds {
        let current = engine
            .executions
            .get(execution_id)
            .cloned()
            .ok_or_else(|| CoreError::Host(format!("unknown execution '{execution_id}'")))?;

        if current.status_kind != "suspended" {
            return Ok(current);
        }

        // Leave HITL for human resume.
        if current.status_detail == "hitl_approval" {
            return Ok(current);
        }

        // step_slice with auto_continue: schedule timer and return (canister layer).
        if current.status_detail == "step_slice" {
            let auto = engine
                .definition
                .as_ref()
                .map(|d| d.bundle.host.auto_continue)
                .unwrap_or(false);
            if auto {
                return Ok(current);
            }
        }

        match resolve_one_effect(engine, execution_id).await? {
            Some(_) => continue,
            None => {
                return engine
                    .executions
                    .get(execution_id)
                    .cloned()
                    .ok_or_else(|| CoreError::Host("execution disappeared".into()));
            }
        }
    }

    engine
        .executions
        .get(execution_id)
        .cloned()
        .ok_or_else(|| CoreError::Host("execution disappeared after effect rounds".into()))
}

async fn llm_prompt(prompt: &str) -> Result<(String, u64, u64), CoreError> {
    #[cfg(target_arch = "wasm32")]
    {
        use ic_llm::Model;
        let model = Model::Llama3_1_8B;
        let text = ic_llm::prompt(model, prompt).await;
        let tokens = (text.len() as u64 / 4).max(1);
        Ok((text, tokens, tokens.saturating_mul(10)))
    }
    #[cfg(not(target_arch = "wasm32"))]
    {
        // Deterministic mock for unit tests (no network).
        let text = format!("mock-llm-response: {prompt}");
        let tokens = 4;
        Ok((text, tokens, 40))
    }
}

fn cycles_balance() -> Option<u128> {
    #[cfg(target_arch = "wasm32")]
    {
        Some(ic_cdk::api::canister_balance128())
    }
    #[cfg(not(target_arch = "wasm32"))]
    {
        None
    }
}

/// Schedule a one-shot timer that resumes `execution_id` (wasm only).
pub fn schedule_auto_continue(execution_id: String, delay_ns: u64) {
    #[cfg(target_arch = "wasm32")]
    {
        use std::time::Duration;
        let _ = ic_cdk_timers::set_timer(Duration::from_nanos(delay_ns), move || {
            ic_cdk::spawn(async move {
                let _ = crate::timer_continue_execution(execution_id).await;
            });
        });
    }
    #[cfg(not(target_arch = "wasm32"))]
    {
        let _ = (execution_id, delay_ns);
    }
}
