use knolo_agent_core::{graph::*, state::*, *};
use serde_json::json;
use std::collections::{BTreeMap, BTreeSet};
fn id<T: std::str::FromStr>(s: &str) -> T
where
    T::Err: std::fmt::Debug,
{
    s.parse().unwrap()
}
fn graph() -> GraphDefinitionV1 {
    GraphDefinitionV1 {
        version: 1,
        id: id("g"),
        state_schema: id("s"),
        entry: id("a"),
        nodes: vec![
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
        ],
        transitions: vec![TransitionDefinitionV1 {
            id: id("t"),
            from: id("a"),
            route: "continue".into(),
            to: id("b"),
        }],
        cycles: vec![],
        limits: ExecutionLimitsV1 {
            max_steps: 3,
            max_tokens: 10,
            max_cost_micros: 10,
            timeout_ms: 10,
        },
    }
}
#[test]
fn graph_validation_rejects_duplicates_unreachable_and_implicit_cycles() {
    let mut g = graph();
    assert!(g.validate().is_ok());
    g.nodes.push(g.nodes[0].clone());
    assert!(g.validate().is_err());
    let mut g = graph();
    g.transitions.push(TransitionDefinitionV1 {
        id: id("back"),
        from: id("b"),
        route: "again".into(),
        to: id("a"),
    });
    assert!(g.validate().is_err());
    g.cycles.push(CycleDefinitionV1 {
        nodes: BTreeSet::from([id("a"), id("b")]),
        max_iterations: 2,
    });
    assert!(g.validate().is_ok());
}
#[test]
fn revisions_conflict_and_reduction_is_deterministic() {
    let schema = StateSchemaV1 {
        version: 1,
        id: id("s"),
        paths: BTreeMap::from([
            ("/n".into(), ValueType::Number),
            ("/x".into(), ValueType::Number),
        ]),
        required: BTreeSet::from(["/n".into()]),
    };
    let state = StateSnapshot {
        schema_id: id("s"),
        revision: 4,
        value: json!({"n":0}),
        provenance: None,
    };
    let writes = BTreeSet::from(["/n".into(), "/x".into()]);
    let provenance = ProvenanceV1 {
        execution_id: id("e"),
        node_id: id("a"),
        event_sequence: 2,
    };
    let patch = StatePatch {
        base_revision: 4,
        operations: BTreeMap::from([
            ("/x".into(), PatchOperation::Set(json!(2))),
            ("/n".into(), PatchOperation::Set(json!(1))),
        ]),
    };
    assert_eq!(
        reduce(&state, &patch, &writes, &schema, provenance.clone()).unwrap(),
        reduce(&state, &patch, &writes, &schema, provenance).unwrap()
    );
    let mut stale = patch;
    stale.base_revision = 3;
    assert!(matches!(
        reduce(
            &state,
            &stale,
            &writes,
            &schema,
            ProvenanceV1 {
                execution_id: id("e"),
                node_id: id("a"),
                event_sequence: 3
            }
        ),
        Err(CoreError::RevisionConflict { .. })
    ));
}
#[test]
fn generated_graph_and_revision_invariants() {
    for n in 1..40 {
        let mut g = graph();
        g.limits.max_steps = n;
        assert!(g.compile().is_ok());
        let state = StateSnapshot {
            schema_id: id("s"),
            revision: n,
            value: json!({"n":0}),
            provenance: None,
        };
        let schema = StateSchemaV1 {
            version: 1,
            id: id("s"),
            paths: BTreeMap::new(),
            required: BTreeSet::new(),
        };
        let p = StatePatch {
            base_revision: n + 1,
            operations: BTreeMap::new(),
        };
        assert!(matches!(
            state.apply(
                &p,
                &BTreeSet::new(),
                &schema,
                ProvenanceV1 {
                    execution_id: id("e"),
                    node_id: id("a"),
                    event_sequence: n
                }
            ),
            Err(CoreError::RevisionConflict { .. })
        ));
    }
}
