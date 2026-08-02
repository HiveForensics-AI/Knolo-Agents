use knolo_agent::checkpoint::InMemoryCheckpointStore;
use knolo_agent::event::EventKindV1;
use knolo_agent::host::ToolRegistry;
use knolo_agent::node::{NodeExecutionV1, NodeExecutor, NodeOutcomeV1, NodeRequest};
use knolo_agent::pack::{load_agent_native, PackAgentReferenceV1};
use knolo_agent::policy::BudgetLedger;
use knolo_agent::replay::{ArtifactHashesV1, ReplayModeV1, ReplayRequestV1};
use knolo_agent::runtime::{FixedClock, RuntimePolicyV1, Scheduler, VecEventSink};
use knolo_agent::state::{StatePatch, StateSchemaV1, StateSnapshot};
use knolo_agent::tool::{ResourceUsageV1, ToolCallV1, ToolDefinition, ToolImplementation};
use knolo_agent::{
    CompiledGraphV1, CoreError, ExecutionId, ExecutionLimitsV1, GraphDefinitionV1,
    NodeDefinitionV1, TransitionDefinitionV1,
};
use serde_json::{json, Value};
use std::collections::{BTreeMap, BTreeSet};

const PACK: &[u8] = include_bytes!("../fixtures/agent-e2e.knolo");

fn id<T: std::str::FromStr>(value: &str) -> T
where
    T::Err: std::fmt::Debug,
{
    value.parse().unwrap()
}

struct EchoTool {
    definition: ToolDefinition,
}

impl ToolImplementation for EchoTool {
    fn definition(&self) -> &ToolDefinition {
        &self.definition
    }

    fn execute(&mut self, _: &Value) -> Result<(Value, ResourceUsageV1), CoreError> {
        Ok((
            json!({"answer": "pack-constrained result"}),
            ResourceUsageV1 {
                calls: 1,
                units: 1,
                duration_ms: 1,
            },
        ))
    }
}

struct ControlPlane;

impl NodeExecutor for ControlPlane {
    fn execute(&mut self, request: NodeRequest<'_>) -> Result<NodeExecutionV1, CoreError> {
        let outcome = if request.node_id.as_str() == "plan" {
            NodeOutcomeV1::Continue {
                patch: StatePatch {
                    base_revision: request.state.revision,
                    operations: BTreeMap::new(),
                },
            }
        } else {
            NodeOutcomeV1::Terminate {
                result: json!("replayed"),
                patch: None,
            }
        };
        Ok(NodeExecutionV1 {
            outcome,
            tokens: 0,
            cost_micros: 0,
        })
    }
}

fn control_graph() -> (CompiledGraphV1, StateSchemaV1, StateSnapshot) {
    let graph = GraphDefinitionV1 {
        version: 1,
        id: id("examples.research.graph"),
        state_schema: id("research.state"),
        entry: id("plan"),
        nodes: vec![
            NodeDefinitionV1 {
                id: id("plan"),
                terminal: false,
                reads: BTreeSet::new(),
                writes: BTreeSet::new(),
            },
            NodeDefinitionV1 {
                id: id("finish"),
                terminal: true,
                reads: BTreeSet::new(),
                writes: BTreeSet::new(),
            },
        ],
        transitions: vec![TransitionDefinitionV1 {
            id: id("plan.continue.finish"),
            from: id("plan"),
            route: "continue".into(),
            to: id("finish"),
        }],
        cycles: vec![],
        limits: ExecutionLimitsV1 {
            max_steps: 4,
            max_tokens: 10,
            max_cost_micros: 10,
            timeout_ms: 1000,
        },
    }
    .compile()
    .unwrap();
    let schema = StateSchemaV1 {
        version: 1,
        id: id("research.state"),
        paths: BTreeMap::new(),
        required: BTreeSet::new(),
    };
    let state = StateSnapshot {
        schema_id: id("research.state"),
        revision: 0,
        value: json!({}),
        provenance: None,
    };
    (graph, schema, state)
}

#[test]
fn loads_pack_and_enforces_capabilities_with_deterministic_control_plane() {
    let loaded = load_agent_native(
        PACK,
        "research",
        PackAgentReferenceV1 {
            graph: id("examples.research.graph"),
            definition: "examples/agents/research.json".into(),
            capabilities: [id("cortex")].into_iter().collect(),
            namespaces: [id("knowledge/private")].into_iter().collect(),
        },
    )
    .unwrap();

    let mut registry = ToolRegistry::default();
    registry
        .register(EchoTool {
            definition: ToolDefinition {
                version: 1,
                id: id("search"),
                namespace: id("knowledge/private"),
                capability: id("cortex"),
                argument_contract: json!({"type": "object", "required": ["q"]}),
                result_contract: json!({"type": "object", "required": ["answer"]}),
            },
        })
        .unwrap();
    registry
        .register(EchoTool {
            definition: ToolDefinition {
                version: 1,
                id: id("export"),
                namespace: id("knowledge/private"),
                capability: id("export"),
                argument_contract: json!({"type": "object"}),
                result_contract: json!({"type": "object", "required": ["answer"]}),
            },
        })
        .unwrap();

    let mut ledger = BudgetLedger::default();
    let mut audit = vec![];
    let allowed = registry
        .execute(
            &loaded.policy,
            &mut ledger,
            ToolCallV1 {
                version: 1,
                call_id: "allowed".into(),
                tool_id: id("search"),
                arguments: json!({"q": "Knolo"}),
            },
            &mut audit,
        )
        .unwrap();
    assert_eq!(allowed.value["answer"], "pack-constrained result");

    let denied = registry
        .execute(
            &loaded.policy,
            &mut ledger,
            ToolCallV1 {
                version: 1,
                call_id: "denied".into(),
                tool_id: id("export"),
                arguments: json!({}),
            },
            &mut audit,
        )
        .unwrap_err();
    assert!(matches!(
        denied,
        CoreError::PolicyDenied(knolo_agent::policy::PolicyDenialV1 {
            code: knolo_agent::policy::PolicyDenialCodeV1::ToolNotAllowed,
            ..
        })
    ));

    let (graph, schema, state) = control_graph();
    let runtime_policy = RuntimePolicyV1 {
        max_retries: 0,
        retry_delay_ms: 0,
        pack_hash: "pack-regression".into(),
        policy_hash: "policy-regression".into(),
        node_implementation_hash: "control-regression".into(),
        contract_hash: "v1".into(),
    };

    let run = |execution_id: &str| {
        let mut executor = ControlPlane;
        let mut sink = VecEventSink::default();
        let mut checkpoints = InMemoryCheckpointStore::default();
        Scheduler::new(
            &graph,
            &schema,
            &mut executor,
            &mut sink,
            &FixedClock(7),
            &mut checkpoints,
            runtime_policy.clone(),
        )
        .run(id::<ExecutionId>(execution_id), state.clone(), || false)
        .unwrap()
    };

    let first = run("regression-run");
    let second = run("regression-run");
    assert_eq!(first.events, second.events);
    assert_eq!(first.state, second.state);
    assert!(first
        .events
        .iter()
        .any(|event| matches!(event.kind, EventKindV1::Terminated)));

    let replay = ReplayRequestV1 {
        version: 1,
        mode: ReplayModeV1::MockedEffects,
        artifacts: ArtifactHashesV1 {
            graph: graph.hash().into(),
            pack: "pack-regression".into(),
            policy: "policy-regression".into(),
            node_implementation: "control-regression".into(),
            contract: "v1".into(),
        },
        live_effect_authorization: None,
    };
    replay.validate(&replay.artifacts).unwrap();
}
