use knolo_agent::{checkpoint::InMemoryCheckpointStore, runtime::*, *};
use serde_json::json;
use std::collections::{BTreeMap, BTreeSet};
fn id<T: std::str::FromStr>(s: &str) -> T
where
    T::Err: std::fmt::Debug,
{
    s.parse().unwrap()
}
fn setup(cycle: bool) -> (CompiledGraphV1, state::StateSchemaV1, state::StateSnapshot) {
    let nodes = vec![
        NodeDefinitionV1 {
            id: id("a"),
            terminal: false,
            reads: BTreeSet::new(),
            writes: BTreeSet::from(["/n".into()]),
        },
        NodeDefinitionV1 {
            id: id("b"),
            terminal: true,
            reads: BTreeSet::new(),
            writes: BTreeSet::new(),
        },
    ];
    let mut ts = vec![TransitionDefinitionV1 {
        id: id("next"),
        from: id("a"),
        route: "continue".into(),
        to: id("b"),
    }];
    if cycle {
        ts.push(TransitionDefinitionV1 {
            id: id("back"),
            from: id("b"),
            route: "continue".into(),
            to: id("a"),
        })
    }
    let g = GraphDefinitionV1 {
        version: 1,
        id: id("g"),
        state_schema: id("s"),
        entry: id("a"),
        nodes,
        transitions: ts,
        cycles: if cycle {
            vec![CycleDefinitionV1 {
                nodes: BTreeSet::from([id("a"), id("b")]),
                max_iterations: 2,
            }]
        } else {
            vec![]
        },
        limits: ExecutionLimitsV1 {
            max_steps: 20,
            max_tokens: 100,
            max_cost_micros: 100,
            timeout_ms: 100,
        },
    }
    .compile()
    .unwrap();
    let schema = state::StateSchemaV1 {
        version: 1,
        id: id("s"),
        paths: BTreeMap::from([("/n".into(), state::ValueType::Number)]),
        required: BTreeSet::from(["/n".into()]),
    };
    let state = state::StateSnapshot {
        schema_id: id("s"),
        revision: 0,
        value: json!({"n":0}),
        provenance: None,
    };
    (g, schema, state)
}
struct Exec {
    calls: u32,
    retry_once: bool,
    cycle: bool,
}
impl node::NodeExecutor for Exec {
    fn execute(&mut self, r: node::NodeRequest<'_>) -> Result<node::NodeExecutionV1, CoreError> {
        self.calls += 1;
        if self.retry_once && self.calls == 1 {
            return Ok(node::NodeExecutionV1 {
                outcome: node::NodeOutcomeV1::Fail {
                    error: "transient".into(),
                    retryable: true,
                },
                tokens: 0,
                cost_micros: 0,
            });
        }
        let outcome = if r.node_id.as_str() == "a" {
            node::NodeOutcomeV1::Continue {
                patch: state::StatePatch {
                    base_revision: r.state.revision,
                    operations: BTreeMap::from([(
                        "/n".into(),
                        state::PatchOperation::Set(json!(r.state.revision + 1)),
                    )]),
                },
            }
        } else if self.cycle {
            node::NodeOutcomeV1::Continue {
                patch: state::StatePatch {
                    base_revision: r.state.revision,
                    operations: BTreeMap::new(),
                },
            }
        } else {
            node::NodeOutcomeV1::Terminate {
                result: json!("ok"),
                patch: None,
            }
        };
        Ok(node::NodeExecutionV1 {
            outcome,
            tokens: 1,
            cost_micros: 1,
        })
    }
}
fn policy() -> RuntimePolicyV1 {
    RuntimePolicyV1 {
        max_retries: 1,
        retry_delay_ms: 0,
        pack_hash: "p".into(),
        policy_hash: "policy".into(),
    }
}
#[test]
fn retries_checkpoint_resume_and_events_are_stable() {
    let (g, schema, state) = setup(false);
    let mut exec = Exec {
        calls: 0,
        retry_once: true,
        cycle: false,
    };
    let mut sink = VecEventSink::default();
    let mut store = InMemoryCheckpointStore::default();
    let report = Scheduler::new(
        &g,
        &schema,
        &mut exec,
        &mut sink,
        &FixedClock(1),
        &mut store,
        policy(),
    )
    .run(id("e"), state, || false)
    .unwrap();
    assert!(matches!(report.status, ExecutionStatusV1::Terminated(_)));
    assert!(report
        .events
        .windows(2)
        .all(|w| w[1].sequence == w[0].sequence + 1));
    assert!(report
        .events
        .iter()
        .any(|e| matches!(e.kind, event::EventKindV1::Retrying { .. })));
    let cp = node::CheckpointStore::load(&store, &id("e"))
        .unwrap()
        .unwrap();
    cp.check_compatible(g.hash(), "p", "policy").unwrap();
    assert!(cp.check_compatible(g.hash(), "wrong", "policy").is_err());
    let mut resumed_exec = Exec {
        calls: 0,
        retry_once: false,
        cycle: false,
    };
    let mut resumed_sink = VecEventSink::default();
    let resumed = Scheduler::new(
        &g,
        &schema,
        &mut resumed_exec,
        &mut resumed_sink,
        &FixedClock(1),
        &mut store,
        policy(),
    )
    .resume(cp, || false)
    .unwrap();
    assert!(matches!(resumed.status, ExecutionStatusV1::Terminated(_)));
}
#[test]
fn cancellation_and_cycle_limits_are_explicit() {
    let (g, schema, state) = setup(false);
    let mut exec = Exec {
        calls: 0,
        retry_once: false,
        cycle: false,
    };
    let mut sink = VecEventSink::default();
    let mut store = InMemoryCheckpointStore::default();
    let r = Scheduler::new(
        &g,
        &schema,
        &mut exec,
        &mut sink,
        &FixedClock(1),
        &mut store,
        policy(),
    )
    .run(id("e"), state, || true)
    .unwrap();
    assert_eq!(r.status, ExecutionStatusV1::Cancelled);
    let (g, schema, state) = setup(true);
    let mut exec = Exec {
        calls: 0,
        retry_once: false,
        cycle: true,
    };
    let mut sink = VecEventSink::default();
    let mut store = InMemoryCheckpointStore::default();
    let r = Scheduler::new(
        &g,
        &schema,
        &mut exec,
        &mut sink,
        &FixedClock(1),
        &mut store,
        policy(),
    )
    .run(id("e2"), state, || false)
    .unwrap();
    assert_eq!(
        r.status,
        ExecutionStatusV1::Failed("cycle limit exceeded".into())
    );
}
