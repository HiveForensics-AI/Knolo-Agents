use knolo_agent_core::{
    checkpoint::CheckpointV1,
    event::{EventKindV1, ExecutionEventV1},
    node::{CheckpointStore, Clock, EventSink, NodeExecutor, NodeOutcomeV1, NodeRequest},
    state::{reduce, ProvenanceV1, StatePatch, StateSchemaV1, StateSnapshot},
    CompiledGraphV1, CoreError, ExecutionId, NodeId,
};
use serde_json::Value;
use std::collections::BTreeMap;
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RuntimePolicyV1 {
    pub max_retries: u32,
    pub retry_delay_ms: u64,
    pub pack_hash: String,
    pub policy_hash: String,
    pub node_implementation_hash: String,
    pub contract_hash: String,
}
#[derive(Debug, Clone, PartialEq)]
pub enum ExecutionStatusV1 {
    Suspended(String),
    Terminated(Value),
    Failed(String),
    Cancelled,
}
#[derive(Debug, Clone, PartialEq)]
pub struct ExecutionReportV1 {
    pub status: ExecutionStatusV1,
    pub state: StateSnapshot,
    pub events: Vec<ExecutionEventV1>,
    pub steps: u64,
    pub tokens: u64,
    pub cost_micros: u64,
}
pub struct Scheduler<'a, E, S, C, K> {
    graph: &'a CompiledGraphV1,
    schema: &'a StateSchemaV1,
    executor: &'a mut E,
    sink: &'a mut S,
    clock: &'a C,
    checkpoints: &'a mut K,
    policy: RuntimePolicyV1,
}
impl<'a, E: NodeExecutor, S: EventSink, C: Clock, K: CheckpointStore> Scheduler<'a, E, S, C, K> {
    pub fn new(
        graph: &'a CompiledGraphV1,
        schema: &'a StateSchemaV1,
        executor: &'a mut E,
        sink: &'a mut S,
        clock: &'a C,
        checkpoints: &'a mut K,
        policy: RuntimePolicyV1,
    ) -> Self {
        Self {
            graph,
            schema,
            executor,
            sink,
            clock,
            checkpoints,
            policy,
        }
    }
    pub fn run(
        &mut self,
        id: ExecutionId,
        state: StateSnapshot,
        cancelled: impl Fn() -> bool,
    ) -> Result<ExecutionReportV1, CoreError> {
        self.run_from(
            id,
            state,
            self.graph.definition().entry.clone(),
            0,
            0,
            0,
            0,
            true,
            cancelled,
        )
    }
    pub fn resume(
        &mut self,
        cp: CheckpointV1,
        cancelled: impl Fn() -> bool,
    ) -> Result<ExecutionReportV1, CoreError> {
        cp.check_artifacts(
            self.graph.hash(),
            &self.policy.pack_hash,
            &self.policy.policy_hash,
            &self.policy.node_implementation_hash,
            &self.policy.contract_hash,
        )?;
        self.run_from(
            cp.execution_id,
            cp.state,
            cp.pending_node,
            cp.event_cursor,
            cp.steps,
            cp.tokens,
            cp.cost_micros,
            false,
            cancelled,
        )
    }
    #[allow(clippy::too_many_arguments)]
    fn run_from(
        &mut self,
        id: ExecutionId,
        mut state: StateSnapshot,
        mut node: NodeId,
        mut seq: u64,
        mut steps: u64,
        mut tokens: u64,
        mut cost: u64,
        started: bool,
        cancelled: impl Fn() -> bool,
    ) -> Result<ExecutionReportV1, CoreError> {
        self.schema.validate(&state.value)?;
        if state.schema_id != self.schema.id {
            return Err(CoreError::SchemaViolation(
                "snapshot schema id mismatch".into(),
            ));
        }
        let start = self.clock.now_ms();
        let mut events = Vec::new();
        let mut visits: BTreeMap<NodeId, u32> = BTreeMap::new();
        if started {
            self.event(
                &id,
                None,
                &mut seq,
                EventKindV1::ExecutionStarted,
                &mut events,
            )?
        }
        loop {
            let limits = self.graph.definition().limits.clone();
            if cancelled() {
                self.event(
                    &id,
                    Some(node),
                    &mut seq,
                    EventKindV1::Cancelled,
                    &mut events,
                )?;
                return Ok(report(
                    ExecutionStatusV1::Cancelled,
                    state,
                    events,
                    steps,
                    tokens,
                    cost,
                ));
            }
            if steps >= limits.max_steps {
                return self.fail(
                    id,
                    node,
                    state,
                    events,
                    seq,
                    steps,
                    tokens,
                    cost,
                    "step budget exceeded",
                );
            };
            if self.clock.now_ms().saturating_sub(start) > limits.timeout_ms {
                return self.fail(
                    id,
                    node,
                    state,
                    events,
                    seq,
                    steps,
                    tokens,
                    cost,
                    "timeout budget exceeded",
                );
            }
            let count = visits.entry(node.clone()).or_default();
            *count += 1;
            if let Some(max) = self.graph.cycle_limit(&node) {
                if *count > max {
                    return self.fail(
                        id,
                        node,
                        state,
                        events,
                        seq,
                        steps,
                        tokens,
                        cost,
                        "cycle limit exceeded",
                    );
                }
            }
            let def = self
                .graph
                .node(&node)
                .ok_or_else(|| CoreError::InvalidGraph("pending node missing".into()))?
                .clone();
            let mut attempt = 0;
            let execution = loop {
                attempt += 1;
                self.event(
                    &id,
                    Some(node.clone()),
                    &mut seq,
                    EventKindV1::NodeStarted { attempt },
                    &mut events,
                )?;
                let x = self.executor.execute(NodeRequest {
                    node_id: &node,
                    state: &state,
                    attempt,
                })?;
                if let NodeOutcomeV1::Fail {
                    error,
                    retryable: true,
                } = &x.outcome
                {
                    if attempt <= self.policy.max_retries {
                        self.event(
                            &id,
                            Some(node.clone()),
                            &mut seq,
                            EventKindV1::Retrying {
                                attempt: attempt + 1,
                            },
                            &mut events,
                        )?;
                        continue;
                    }
                    let error = error.clone();
                    return self.fail(id, node, state, events, seq, steps, tokens, cost, &error);
                }
                break x;
            };
            steps += 1;
            tokens = tokens.saturating_add(execution.tokens);
            cost = cost.saturating_add(execution.cost_micros);
            if tokens > limits.max_tokens {
                return self.fail(
                    id,
                    node,
                    state,
                    events,
                    seq,
                    steps,
                    tokens,
                    cost,
                    "token budget exceeded",
                );
            }
            if cost > limits.max_cost_micros {
                return self.fail(
                    id,
                    node,
                    state,
                    events,
                    seq,
                    steps,
                    tokens,
                    cost,
                    "cost budget exceeded",
                );
            }
            let (patch, next, status, decision) = match execution.outcome {
                NodeOutcomeV1::Continue { patch } => (
                    Some(patch),
                    self.graph.route(&node, "continue").cloned(),
                    None,
                    None,
                ),
                NodeOutcomeV1::Route { route, patch } => {
                    let to = self.graph.route(&node, &route).cloned().ok_or_else(|| {
                        CoreError::InvalidGraph(format!("undeclared route {route}"))
                    })?;
                    (
                        patch,
                        Some(to.clone()),
                        None,
                        Some(EventKindV1::Routed { route, to }),
                    )
                }
                NodeOutcomeV1::Suspend { reason, patch } => (
                    patch,
                    None,
                    Some(ExecutionStatusV1::Suspended(reason.clone())),
                    Some(EventKindV1::Suspended { reason }),
                ),
                NodeOutcomeV1::Terminate { result, patch } => (
                    patch,
                    None,
                    Some(ExecutionStatusV1::Terminated(result)),
                    Some(EventKindV1::Terminated),
                ),
                NodeOutcomeV1::Fail { error, .. } => (
                    None,
                    None,
                    Some(ExecutionStatusV1::Failed(error.clone())),
                    Some(EventKindV1::Failed { error }),
                ),
            };
            if let Some(p) = patch {
                state = self.patch(&id, &node, state, p, &def.writes, seq)?;
                self.event(
                    &id,
                    Some(node.clone()),
                    &mut seq,
                    EventKindV1::StatePatched {
                        revision: state.revision,
                    },
                    &mut events,
                )?
            }
            if let Some(kind) = decision {
                self.event(&id, Some(node.clone()), &mut seq, kind, &mut events)?
            }
            if let Some(status) = status {
                return Ok(report(status, state, events, steps, tokens, cost));
            }
            let pending = next.ok_or_else(|| {
                CoreError::InvalidGraph("continue has no declared `continue` transition".into())
            })?;
            let cp = CheckpointV1 {
                version: 1,
                execution_id: id.clone(),
                graph_hash: self.graph.hash().into(),
                pack_hash: self.policy.pack_hash.clone(),
                policy_hash: self.policy.policy_hash.clone(),
                node_implementation_hash: self.policy.node_implementation_hash.clone(),
                contract_hash: self.policy.contract_hash.clone(),
                state: state.clone(),
                pending_node: pending.clone(),
                event_cursor: seq + 1,
                steps,
                tokens,
                cost_micros: cost,
            };
            self.event(
                &id,
                Some(node.clone()),
                &mut seq,
                EventKindV1::Checkpointed,
                &mut events,
            )?;
            self.checkpoints.save(&cp)?;
            node = pending;
        }
    }
    fn patch(
        &self,
        id: &ExecutionId,
        node: &NodeId,
        state: StateSnapshot,
        patch: StatePatch,
        writes: &std::collections::BTreeSet<String>,
        seq: u64,
    ) -> Result<StateSnapshot, CoreError> {
        reduce(
            &state,
            &patch,
            writes,
            self.schema,
            ProvenanceV1 {
                execution_id: id.clone(),
                node_id: node.clone(),
                event_sequence: seq + 1,
            },
        )
    }
    fn event(
        &mut self,
        id: &ExecutionId,
        node: Option<NodeId>,
        seq: &mut u64,
        kind: EventKindV1,
        out: &mut Vec<ExecutionEventV1>,
    ) -> Result<(), CoreError> {
        *seq += 1;
        let e = ExecutionEventV1 {
            version: 1,
            sequence: *seq,
            execution_id: id.clone(),
            node_id: node,
            timestamp_ms: self.clock.now_ms(),
            kind,
        };
        self.sink.emit(&e)?;
        out.push(e);
        Ok(())
    }
    #[allow(clippy::too_many_arguments)]
    fn fail(
        &mut self,
        id: ExecutionId,
        node: NodeId,
        state: StateSnapshot,
        mut events: Vec<ExecutionEventV1>,
        mut seq: u64,
        steps: u64,
        tokens: u64,
        cost: u64,
        msg: &str,
    ) -> Result<ExecutionReportV1, CoreError> {
        self.event(
            &id,
            Some(node),
            &mut seq,
            EventKindV1::Failed { error: msg.into() },
            &mut events,
        )?;
        Ok(report(
            ExecutionStatusV1::Failed(msg.into()),
            state,
            events,
            steps,
            tokens,
            cost,
        ))
    }
}
fn report(
    status: ExecutionStatusV1,
    state: StateSnapshot,
    events: Vec<ExecutionEventV1>,
    steps: u64,
    tokens: u64,
    cost_micros: u64,
) -> ExecutionReportV1 {
    ExecutionReportV1 {
        status,
        state,
        events,
        steps,
        tokens,
        cost_micros,
    }
}
#[derive(Default)]
pub struct VecEventSink(pub Vec<ExecutionEventV1>);
impl EventSink for VecEventSink {
    fn emit(&mut self, e: &ExecutionEventV1) -> Result<(), CoreError> {
        self.0.push(e.clone());
        Ok(())
    }
}
#[derive(Debug, Clone, Copy)]
pub struct FixedClock(pub u64);
impl Clock for FixedClock {
    fn now_ms(&self) -> u64 {
        self.0
    }
}
