//! Node implementations: pure Phase 1 demos + Phase 2 host-effects graph.
use knolo_agent_core::{
    node::{NodeExecutionV1, NodeExecutor, NodeOutcomeV1, NodeRequest},
    state::{PatchOperation, StatePatch},
    CoreError,
};
use serde_json::{json, Value};
use std::collections::BTreeMap;

/// Built-in executors keyed by `implementation_id` on the definition bundle.
#[derive(Debug, Clone)]
pub struct DeterministicExecutor {
    pub implementation_id: String,
    /// Optional remaining node executions before forced suspend (step slicing).
    pub remaining_steps: Option<u32>,
    /// After HITL resume, human-gate nodes may proceed.
    pub hitl_approved: bool,
    /// Injected host effect results keyed by effect name (`llm`, `tool`, `retrieve`).
    pub effect_cache: BTreeMap<String, Value>,
}

impl DeterministicExecutor {
    pub fn new(implementation_id: impl Into<String>) -> Self {
        Self {
            implementation_id: implementation_id.into(),
            remaining_steps: None,
            hitl_approved: false,
            effect_cache: BTreeMap::new(),
        }
    }

    pub fn with_step_budget(mut self, max_steps: u32) -> Self {
        self.remaining_steps = Some(max_steps);
        self
    }

    pub fn with_hitl_approved(mut self, approved: bool) -> Self {
        self.hitl_approved = approved;
        self
    }

    pub fn with_effect_cache(mut self, cache: BTreeMap<String, Value>) -> Self {
        self.effect_cache = cache;
        self
    }

    fn consume_step_budget(&mut self) {
        if let Some(left) = self.remaining_steps.as_mut() {
            if *left > 0 {
                *left -= 1;
            }
        }
    }
}

impl NodeExecutor for DeterministicExecutor {
    fn execute(&mut self, request: NodeRequest<'_>) -> Result<NodeExecutionV1, CoreError> {
        if let Some(0) = self.remaining_steps {
            return Ok(NodeExecutionV1 {
                outcome: NodeOutcomeV1::Suspend {
                    reason: "step_slice".into(),
                    patch: None,
                },
                tokens: 0,
                cost_micros: 0,
            });
        }
        self.consume_step_budget();

        match self.implementation_id.as_str() {
            "portable-counter-v1" => portable_counter(request),
            "a-b-terminate-v1" => a_b_terminate(request),
            "suspend-demo-v1" => suspend_demo(request, self.hitl_approved),
            "host-effects-v1" => host_effects(request, &self.effect_cache),
            other => Err(CoreError::Host(format!(
                "unknown implementation_id '{other}'"
            ))),
        }
    }
}

fn portable_counter(request: NodeRequest<'_>) -> Result<NodeExecutionV1, CoreError> {
    let id = request.node_id.as_str();
    if id == "increment" {
        let count = request
            .state
            .value
            .pointer("/count")
            .and_then(Value::as_u64)
            .unwrap_or(0);
        return Ok(NodeExecutionV1 {
            outcome: NodeOutcomeV1::Continue {
                patch: StatePatch {
                    base_revision: request.state.revision,
                    operations: BTreeMap::from([(
                        "/count".into(),
                        PatchOperation::Set(json!(count + 1)),
                    )]),
                },
            },
            tokens: 1,
            cost_micros: 1,
        });
    }
    if id == "done" {
        return Ok(NodeExecutionV1 {
            outcome: NodeOutcomeV1::Terminate {
                result: json!({ "ok": true, "count": request.state.value.pointer("/count") }),
                patch: None,
            },
            tokens: 1,
            cost_micros: 1,
        });
    }
    Err(CoreError::Host(format!(
        "portable-counter-v1 has no behavior for node '{id}'"
    )))
}

fn a_b_terminate(request: NodeRequest<'_>) -> Result<NodeExecutionV1, CoreError> {
    let id = request.node_id.as_str();
    if id == "a" {
        return Ok(NodeExecutionV1 {
            outcome: NodeOutcomeV1::Continue {
                patch: StatePatch {
                    base_revision: request.state.revision,
                    operations: BTreeMap::from([(
                        "/n".into(),
                        PatchOperation::Set(json!(request.state.revision + 1)),
                    )]),
                },
            },
            tokens: 1,
            cost_micros: 1,
        });
    }
    if id == "b" {
        return Ok(NodeExecutionV1 {
            outcome: NodeOutcomeV1::Terminate {
                result: json!("ok"),
                patch: None,
            },
            tokens: 1,
            cost_micros: 1,
        });
    }
    Err(CoreError::Host(format!(
        "a-b-terminate-v1 has no behavior for node '{id}'"
    )))
}

fn suspend_demo(
    request: NodeRequest<'_>,
    hitl_approved: bool,
) -> Result<NodeExecutionV1, CoreError> {
    let id = request.node_id.as_str();
    if id == "work" {
        return Ok(NodeExecutionV1 {
            outcome: NodeOutcomeV1::Continue {
                patch: StatePatch {
                    base_revision: request.state.revision,
                    operations: BTreeMap::from([(
                        "/phase".into(),
                        PatchOperation::Set(json!("worked")),
                    )]),
                },
            },
            tokens: 1,
            cost_micros: 1,
        });
    }
    if id == "await_human" {
        if hitl_approved {
            return Ok(NodeExecutionV1 {
                outcome: NodeOutcomeV1::Continue {
                    patch: StatePatch {
                        base_revision: request.state.revision,
                        operations: BTreeMap::from([(
                            "/phase".into(),
                            PatchOperation::Set(json!("approved")),
                        )]),
                    },
                },
                tokens: 1,
                cost_micros: 1,
            });
        }
        return Ok(NodeExecutionV1 {
            outcome: NodeOutcomeV1::Suspend {
                reason: "hitl_approval".into(),
                patch: None,
            },
            tokens: 0,
            cost_micros: 0,
        });
    }
    if id == "finish" {
        return Ok(NodeExecutionV1 {
            outcome: NodeOutcomeV1::Terminate {
                result: json!({ "approved": true }),
                patch: None,
            },
            tokens: 1,
            cost_micros: 1,
        });
    }
    Err(CoreError::Host(format!(
        "suspend-demo-v1 has no behavior for node '{id}'"
    )))
}

/// Phase 2 graph: prepare → llm → tool → retrieve → done.
///
/// Effect nodes suspend with `await_*` until the host injects a result into
/// `effect_cache` and resumes. This keeps `NodeExecutor` synchronous while
/// allowing async canister effects (ic-llm, outcalls, inter-canister).
fn host_effects(
    request: NodeRequest<'_>,
    cache: &BTreeMap<String, Value>,
) -> Result<NodeExecutionV1, CoreError> {
    let id = request.node_id.as_str();
    match id {
        "prepare" => Ok(NodeExecutionV1 {
            outcome: NodeOutcomeV1::Continue {
                patch: StatePatch {
                    base_revision: request.state.revision,
                    operations: BTreeMap::from([(
                        "/phase".into(),
                        PatchOperation::Set(json!("prepared")),
                    )]),
                },
            },
            tokens: 0,
            cost_micros: 0,
        }),
        "llm" => {
            if let Some(result) = cache.get("llm") {
                return Ok(NodeExecutionV1 {
                    outcome: NodeOutcomeV1::Continue {
                        patch: StatePatch {
                            base_revision: request.state.revision,
                            operations: BTreeMap::from([
                                ("/phase".into(), PatchOperation::Set(json!("llm_done"))),
                                ("/llm_result".into(), PatchOperation::Set(result.clone())),
                            ]),
                        },
                    },
                    tokens: result.get("tokens").and_then(Value::as_u64).unwrap_or(8),
                    cost_micros: result
                        .get("cost_micros")
                        .and_then(Value::as_u64)
                        .unwrap_or(100),
                });
            }
            Ok(NodeExecutionV1 {
                outcome: NodeOutcomeV1::Suspend {
                    reason: "await_llm".into(),
                    patch: None,
                },
                tokens: 0,
                cost_micros: 0,
            })
        }
        "tool" => {
            if let Some(result) = cache.get("tool") {
                return Ok(NodeExecutionV1 {
                    outcome: NodeOutcomeV1::Continue {
                        patch: StatePatch {
                            base_revision: request.state.revision,
                            operations: BTreeMap::from([
                                ("/phase".into(), PatchOperation::Set(json!("tool_done"))),
                                ("/tool_result".into(), PatchOperation::Set(result.clone())),
                            ]),
                        },
                    },
                    tokens: 0,
                    cost_micros: result
                        .get("cost_micros")
                        .and_then(Value::as_u64)
                        .unwrap_or(10),
                });
            }
            Ok(NodeExecutionV1 {
                outcome: NodeOutcomeV1::Suspend {
                    reason: "await_tool".into(),
                    patch: None,
                },
                tokens: 0,
                cost_micros: 0,
            })
        }
        "retrieve" => {
            if let Some(result) = cache.get("retrieve") {
                return Ok(NodeExecutionV1 {
                    outcome: NodeOutcomeV1::Continue {
                        patch: StatePatch {
                            base_revision: request.state.revision,
                            operations: BTreeMap::from([
                                ("/phase".into(), PatchOperation::Set(json!("retrieve_done"))),
                                (
                                    "/retrieval_result".into(),
                                    PatchOperation::Set(result.clone()),
                                ),
                            ]),
                        },
                    },
                    tokens: 0,
                    cost_micros: 5,
                });
            }
            Ok(NodeExecutionV1 {
                outcome: NodeOutcomeV1::Suspend {
                    reason: "await_retrieve".into(),
                    patch: None,
                },
                tokens: 0,
                cost_micros: 0,
            })
        }
        "done" => Ok(NodeExecutionV1 {
            outcome: NodeOutcomeV1::Terminate {
                result: json!({
                    "ok": true,
                    "phase": request.state.value.pointer("/phase"),
                    "llm": request.state.value.pointer("/llm_result"),
                    "tool": request.state.value.pointer("/tool_result"),
                    "retrieval": request.state.value.pointer("/retrieval_result"),
                }),
                patch: None,
            },
            tokens: 0,
            cost_micros: 0,
        }),
        other => Err(CoreError::Host(format!(
            "host-effects-v1 has no behavior for node '{other}'"
        ))),
    }
}

/// Suspend reasons that the host can resolve automatically.
pub fn is_host_effect_suspend(reason: &str) -> bool {
    matches!(
        reason,
        "await_llm" | "await_tool" | "await_retrieve" | "step_slice"
    )
}
