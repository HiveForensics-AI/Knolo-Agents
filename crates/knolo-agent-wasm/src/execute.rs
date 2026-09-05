use crate::protocol::{
    DispatchRequest, Failure, Inspection, PortableSession, ProtocolCommand, ProtocolEvent,
    ProtocolEventKind, ProtocolNodeExecution, ProtocolOutcome, ProtocolReport, ProtocolRequest,
    ProtocolResponse, ProtocolStatus, CAPABILITIES, LIMITATIONS,
};
use knolo_agent_core::{
    checkpoint::CheckpointV1,
    state::{PatchOperation, ProvenanceV1, StatePatch, StateSchemaV1, StateSnapshot},
    CompiledGraphV1, CoreError, ExecutionId, GraphDefinitionV1, NodeId,
};
use serde_json::Value;
use std::collections::BTreeMap;

pub fn handle(request: ProtocolRequest) -> Vec<ProtocolResponse> {
    if request.version != 1 {
        return vec![fail("unsupported", "unsupported protocol version")];
    }
    let compiled = match request.graph.compile() {
        Ok(compiled) => compiled,
        Err(error) => return vec![fail("definition", error.to_string())],
    };
    match request.command {
        ProtocolCommand::Inspect => vec![ProtocolResponse::Inspection {
            inspection: Inspection {
                engine: "wasm",
                graph: compiled.definition().clone(),
                capabilities: CAPABILITIES,
                limitations: LIMITATIONS,
            },
        }],
        ProtocolCommand::Replay => {
            vec![fail(
                "unsupported",
                "replay is a host-side compare; re-run with the same execution_id",
            )]
        }
        ProtocolCommand::Run {
            execution_id,
            state,
        } => match start_run(
            &compiled,
            request.schema.as_ref(),
            execution_id,
            state,
            request.now_ms.unwrap_or(0),
        ) {
            Ok(responses) => responses,
            Err(failure) => vec![failure],
        },
        ProtocolCommand::Resume { checkpoint, input } => {
            match start_resume(
                &compiled,
                request.schema.as_ref(),
                checkpoint,
                input,
                request.now_ms.unwrap_or(0),
            ) {
                Ok(responses) => responses,
                Err(failure) => vec![failure],
            }
        }
        ProtocolCommand::Continue { session, execution } => match continue_run(
            &compiled,
            request.schema.as_ref(),
            session,
            execution,
            request.now_ms.unwrap_or(0),
        ) {
            Ok(responses) => responses,
            Err(failure) => vec![failure],
        },
    }
}

fn start_run(
    compiled: &CompiledGraphV1,
    schema: Option<&StateSchemaV1>,
    execution_id: String,
    state: Value,
    now_ms: u64,
) -> Result<Vec<ProtocolResponse>, ProtocolResponse> {
    let schema = require_schema(compiled.definition(), schema)?;
    schema
        .validate(&state)
        .map_err(|error| fail("definition", error.to_string()))?;
    if schema.id != compiled.definition().state_schema {
        return Err(fail(
            "definition",
            "schema id does not match graph.state_schema",
        ));
    }
    let snapshot = StateSnapshot {
        schema_id: schema.id.clone(),
        revision: 0,
        value: state,
        provenance: None,
    };
    let mut session = PortableSession {
        version: 1,
        execution_id,
        graph_hash: compiled.hash().into(),
        state: snapshot.clone(),
        current_node: compiled.definition().entry.to_string(),
        sequence: 0,
        steps: 0,
        tokens: 0,
        cost_micros: 0,
        snapshots: vec![snapshot],
        visits: BTreeMap::new(),
        start_ms: now_ms,
        awaiting_node: String::new(),
        awaiting_attempt: 0,
        events: Vec::new(),
        resume_input: None,
    };
    let mut fresh = Vec::new();
    emit(
        &mut session,
        None,
        ProtocolEventKind::ExecutionStarted,
        now_ms,
        &mut fresh,
    );
    dispatch_node(compiled, session, now_ms, fresh)
}

fn start_resume(
    compiled: &CompiledGraphV1,
    schema: Option<&StateSchemaV1>,
    checkpoint: CheckpointV1,
    input: Value,
    now_ms: u64,
) -> Result<Vec<ProtocolResponse>, ProtocolResponse> {
    let schema = require_schema(compiled.definition(), schema)?;
    if checkpoint.version != 1 || checkpoint.graph_hash != compiled.hash() {
        return Err(fail("definition", "checkpoint graph hash mismatch"));
    }
    schema
        .validate(&checkpoint.state.value)
        .map_err(|error| fail("definition", error.to_string()))?;
    if checkpoint.state.schema_id != schema.id {
        return Err(fail("definition", "snapshot schema id mismatch"));
    }
    if compiled.node(&checkpoint.pending_node).is_none() {
        return Err(fail("definition", "pending node missing"));
    }
    let session = PortableSession {
        version: 1,
        execution_id: checkpoint.execution_id.to_string(),
        graph_hash: compiled.hash().into(),
        snapshots: vec![checkpoint.state.clone()],
        state: checkpoint.state,
        current_node: checkpoint.pending_node.to_string(),
        sequence: checkpoint.event_cursor,
        steps: checkpoint.steps,
        tokens: checkpoint.tokens,
        cost_micros: checkpoint.cost_micros,
        visits: BTreeMap::new(),
        start_ms: now_ms,
        awaiting_node: String::new(),
        awaiting_attempt: 0,
        events: Vec::new(),
        resume_input: Some(input),
    };
    dispatch_node(compiled, session, now_ms, Vec::new())
}

fn continue_run(
    compiled: &CompiledGraphV1,
    schema: Option<&StateSchemaV1>,
    mut session: PortableSession,
    execution: ProtocolNodeExecution,
    now_ms: u64,
) -> Result<Vec<ProtocolResponse>, ProtocolResponse> {
    let schema = require_schema(compiled.definition(), schema)?;
    if session.version != 1 || session.graph_hash != compiled.hash() {
        return Err(fail("definition", "session graph hash mismatch"));
    }
    if session.awaiting_node.is_empty() {
        return Err(fail("execution", "session is not awaiting a node result"));
    }
    let node_id: NodeId = session
        .awaiting_node
        .parse()
        .map_err(|error: CoreError| fail("definition", error.to_string()))?;
    let def = compiled
        .node(&node_id)
        .cloned()
        .ok_or_else(|| fail("definition", "pending node missing"))?;
    session.awaiting_node.clear();
    session.awaiting_attempt = 0;

    let mut fresh = Vec::new();
    session.steps = session.steps.saturating_add(1);
    session.tokens = session.tokens.saturating_add(execution.tokens.unwrap_or(0));
    session.cost_micros = session
        .cost_micros
        .saturating_add(execution.cost_micros.unwrap_or(0));
    let limits = compiled.definition().limits.clone();
    if session.tokens > limits.max_tokens {
        return fail_report(
            &mut session,
            &node_id,
            now_ms,
            "token budget exceeded",
            fresh,
        );
    }
    if session.cost_micros > limits.max_cost_micros {
        return fail_report(
            &mut session,
            &node_id,
            now_ms,
            "cost budget exceeded",
            fresh,
        );
    }

    let (patch, next, status, decision) = match execution.outcome {
        ProtocolOutcome::Continue { patch } => (
            patch,
            Some(
                compiled
                    .route(&node_id, "continue")
                    .cloned()
                    .ok_or_else(|| {
                        fail(
                            "definition",
                            "continue has no declared `continue` transition",
                        )
                    })?,
            ),
            None,
            None,
        ),
        ProtocolOutcome::Route { route, patch } => {
            let to = compiled
                .route(&node_id, &route)
                .cloned()
                .ok_or_else(|| fail("definition", format!("undeclared route {route}")))?;
            (
                patch,
                Some(to.clone()),
                None,
                Some(ProtocolEventKind::Routed {
                    route,
                    to: to.to_string(),
                }),
            )
        }
        ProtocolOutcome::Suspend { reason, patch } => (
            patch,
            None,
            Some(ProtocolStatus::Suspended {
                reason: reason.clone(),
            }),
            Some(ProtocolEventKind::Suspended { reason }),
        ),
        ProtocolOutcome::Terminate { result, patch } => (
            patch,
            None,
            Some(ProtocolStatus::Terminated { result }),
            Some(ProtocolEventKind::Terminated),
        ),
        ProtocolOutcome::Fail { error: message, .. } => (
            None,
            None,
            Some(ProtocolStatus::Failed {
                error: message.clone(),
            }),
            Some(ProtocolEventKind::Failed { error: message }),
        ),
    };

    if let Some(patch) = patch {
        apply_patch(&mut session, &node_id, &def.writes, schema, patch)?;
        let revision = session.state.revision;
        emit(
            &mut session,
            Some(node_id.to_string()),
            ProtocolEventKind::StatePatched { revision },
            now_ms,
            &mut fresh,
        );
    }
    if let Some(kind) = decision {
        emit(
            &mut session,
            Some(node_id.to_string()),
            kind,
            now_ms,
            &mut fresh,
        );
    }
    if let Some(status) = status {
        return Ok(finish(session, status, fresh));
    }
    let pending = next.ok_or_else(|| {
        fail(
            "definition",
            "continue has no declared `continue` transition",
        )
    })?;
    emit(
        &mut session,
        Some(node_id.to_string()),
        ProtocolEventKind::Checkpointed,
        now_ms,
        &mut fresh,
    );
    session.current_node = pending.to_string();
    dispatch_node(compiled, session, now_ms, fresh)
}

fn dispatch_node(
    compiled: &CompiledGraphV1,
    mut session: PortableSession,
    now_ms: u64,
    mut fresh: Vec<ProtocolEvent>,
) -> Result<Vec<ProtocolResponse>, ProtocolResponse> {
    let limits = compiled.definition().limits.clone();
    let node_id: NodeId = session
        .current_node
        .parse()
        .map_err(|error: CoreError| fail("definition", error.to_string()))?;
    if session.steps >= limits.max_steps {
        return fail_report(
            &mut session,
            &node_id,
            now_ms,
            "step budget exceeded",
            fresh,
        );
    }
    if now_ms.saturating_sub(session.start_ms) > limits.timeout_ms {
        return fail_report(
            &mut session,
            &node_id,
            now_ms,
            "timeout budget exceeded",
            fresh,
        );
    }
    let count = session
        .visits
        .entry(session.current_node.clone())
        .or_insert(0);
    *count += 1;
    if let Some(max) = compiled.cycle_limit(&node_id) {
        if *count > max {
            return fail_report(
                &mut session,
                &node_id,
                now_ms,
                "cycle limit exceeded",
                fresh,
            );
        }
    }
    compiled
        .node(&node_id)
        .ok_or_else(|| fail("definition", "pending node missing"))?;
    emit(
        &mut session,
        Some(node_id.to_string()),
        ProtocolEventKind::NodeStarted { attempt: 1 },
        now_ms,
        &mut fresh,
    );
    session.awaiting_node = node_id.to_string();
    session.awaiting_attempt = 1;
    let mut responses = events(fresh);
    responses.push(ProtocolResponse::Dispatch {
        request: DispatchRequest {
            node_id: node_id.to_string(),
            state: session.state.value.clone(),
            attempt: 1,
        },
        session,
    });
    Ok(responses)
}

fn apply_patch(
    session: &mut PortableSession,
    node_id: &NodeId,
    writes: &std::collections::BTreeSet<String>,
    schema: &StateSchemaV1,
    patch: Value,
) -> Result<(), ProtocolResponse> {
    let object = patch
        .as_object()
        .ok_or_else(|| fail("definition", "node patch must be a JSON object"))?;
    let mut operations = BTreeMap::new();
    for (key, value) in object {
        if key.is_empty() || key.contains('/') {
            return Err(fail(
                "definition",
                format!("patch key {key} must be a top-level state field"),
            ));
        }
        operations.insert(format!("/{key}"), PatchOperation::Set(value.clone()));
    }
    if operations.is_empty() {
        return Ok(());
    }
    let execution_id: ExecutionId = session
        .execution_id
        .parse()
        .map_err(|error: CoreError| fail("definition", error.to_string()))?;
    let next = session
        .state
        .apply(
            &StatePatch {
                base_revision: session.state.revision,
                operations,
            },
            writes,
            schema,
            ProvenanceV1 {
                execution_id,
                node_id: node_id.clone(),
                event_sequence: session.sequence + 1,
            },
        )
        .map_err(|error| fail("definition", error.to_string()))?;
    session.state = next.clone();
    session.snapshots.push(next);
    Ok(())
}

fn fail_report(
    session: &mut PortableSession,
    node_id: &NodeId,
    now_ms: u64,
    message: &str,
    mut fresh: Vec<ProtocolEvent>,
) -> Result<Vec<ProtocolResponse>, ProtocolResponse> {
    emit(
        session,
        Some(node_id.to_string()),
        ProtocolEventKind::Failed {
            error: message.into(),
        },
        now_ms,
        &mut fresh,
    );
    Ok(finish(
        session.clone(),
        ProtocolStatus::Failed {
            error: message.into(),
        },
        fresh,
    ))
}

fn finish(
    session: PortableSession,
    status: ProtocolStatus,
    fresh: Vec<ProtocolEvent>,
) -> Vec<ProtocolResponse> {
    let mut responses = events(fresh);
    responses.push(ProtocolResponse::Report {
        report: ProtocolReport {
            status,
            state: session.state,
            events: session.events,
            steps: session.steps,
            tokens: session.tokens,
            cost_micros: session.cost_micros,
            snapshots: session.snapshots,
        },
    });
    responses
}

fn emit(
    session: &mut PortableSession,
    node_id: Option<String>,
    kind: ProtocolEventKind,
    timestamp_ms: u64,
    fresh: &mut Vec<ProtocolEvent>,
) {
    session.sequence += 1;
    let event = ProtocolEvent {
        version: 1,
        sequence: session.sequence,
        execution_id: session.execution_id.clone(),
        node_id,
        timestamp_ms,
        kind,
    };
    session.events.push(event.clone());
    fresh.push(event);
}

fn events(fresh: Vec<ProtocolEvent>) -> Vec<ProtocolResponse> {
    fresh
        .into_iter()
        .map(|event| ProtocolResponse::Event { event })
        .collect()
}

fn require_schema<'a>(
    graph: &GraphDefinitionV1,
    schema: Option<&'a StateSchemaV1>,
) -> Result<&'a StateSchemaV1, ProtocolResponse> {
    let _ = graph;
    schema.ok_or_else(|| {
        fail(
            "definition",
            "run, resume, and continue require a state schema",
        )
    })
}

fn fail(kind: &'static str, message: impl Into<String>) -> ProtocolResponse {
    ProtocolResponse::Error {
        failure: Failure {
            kind,
            message: message.into(),
        },
    }
}
