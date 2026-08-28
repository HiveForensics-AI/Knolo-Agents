//! Pack -> agent definition -> policy -> deterministic replay.
//! Run with `cargo run -p knolo-agent --example pack_e2e`.
use knolo_agent::runtime::{FixedClock, VecEventSink};
use knolo_agent::{
    event::EventKindV1,
    node::{NodeExecutionV1, NodeExecutor, NodeOutcomeV1},
    state::{StateSchemaV1, StateSnapshot},
    CompiledGraphV1, ExecutionId,
};
use knolo_agent::{
    host::ToolRegistry,
    pack::{load_agent_native, PackAgentReferenceV1},
    policy::BudgetLedger,
    replay::{ArtifactHashesV1, ReplayModeV1, ReplayRequestV1},
    runtime::{RuntimePolicyV1, Scheduler},
    tool::{RetryClassV1, ToolCallV1, ToolImplementation},
    CoreError,
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
    definition: knolo_agent::tool::ToolDefinition,
}
impl ToolImplementation for EchoTool {
    fn definition(&self) -> &knolo_agent::tool::ToolDefinition {
        &self.definition
    }
    fn execute(
        &mut self,
        _: &Value,
    ) -> Result<(Value, knolo_agent::tool::ResourceUsageV1), CoreError> {
        Ok((
            json!({"answer": "pack-constrained result"}),
            knolo_agent::tool::ResourceUsageV1 {
                calls: 1,
                units: 1,
                duration_ms: 1,
            },
        ))
    }
}

struct ControlPlane;
impl NodeExecutor for ControlPlane {
    fn execute(
        &mut self,
        request: knolo_agent::node::NodeRequest<'_>,
    ) -> Result<NodeExecutionV1, CoreError> {
        let outcome = if request.node_id.as_str() == "plan" {
            NodeOutcomeV1::Continue {
                patch: knolo_agent::state::StatePatch {
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
    let graph = knolo_agent::GraphDefinitionV1 {
        version: 1,
        id: id("examples.research.graph"),
        state_schema: id("research.state"),
        entry: id("plan"),
        nodes: vec![
            knolo_agent::NodeDefinitionV1 {
                id: id("plan"),
                terminal: false,
                reads: BTreeSet::new(),
                writes: BTreeSet::new(),
            },
            knolo_agent::NodeDefinitionV1 {
                id: id("finish"),
                terminal: true,
                reads: BTreeSet::new(),
                writes: BTreeSet::new(),
            },
        ],
        transitions: vec![knolo_agent::TransitionDefinitionV1 {
            id: id("plan.continue.finish"),
            from: id("plan"),
            route: "continue".into(),
            to: id("finish"),
        }],
        cycles: vec![],
        limits: knolo_agent::ExecutionLimitsV1 {
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

fn main() -> Result<(), CoreError> {
    let loaded = load_agent_native(
        PACK,
        "research",
        PackAgentReferenceV1 {
            graph: id("examples.research.graph"),
            definition: "examples/agents/research.json".into(),
            capabilities: [id("cortex")].into_iter().collect(),
            namespaces: [id("knowledge/private")].into_iter().collect(),
        },
    )?;
    let mut registry = ToolRegistry::default();
    registry.register(EchoTool {
        definition: knolo_agent::tool::ToolDefinition {
            version: 1,
            id: id("search"),
            namespace: id("knowledge/private"),
            capability: id("cortex"),
            argument_contract: json!({"type":"object","required":["q"]}),
            result_contract: json!({"type":"object","required":["answer"]}),
            retry_class: RetryClassV1::Idempotent,
        },
    })?;
    registry.register(EchoTool {
        definition: knolo_agent::tool::ToolDefinition {
            version: 1,
            id: id("export"),
            namespace: id("knowledge/private"),
            capability: id("export"),
            argument_contract: json!({"type":"object"}),
            result_contract: json!({"type":"object","required":["answer"]}),
            retry_class: RetryClassV1::NonIdempotent,
        },
    })?;
    let mut ledger = BudgetLedger::default();
    let mut audit = vec![];
    let success = registry.execute(
        &loaded.policy,
        &mut ledger,
        ToolCallV1 {
            version: 1,
            call_id: "allowed".into(),
            tool_id: id("search"),
            arguments: json!({"q":"Knolo"}),
        },
        &mut audit,
    )?;
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
        pack_hash: "pack-e2e".into(),
        policy_hash: "policy-e2e".into(),
        node_implementation_hash: "control-e2e".into(),
        contract_hash: "v1".into(),
    };
    let run = |execution_id: &str| {
        let mut executor = ControlPlane;
        let mut sink = VecEventSink::default();
        let mut checkpoints = knolo_agent::checkpoint::InMemoryCheckpointStore::default();
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
    let first = run("research-run");
    let second = run("research-run");
    assert_eq!(first.events, second.events);
    assert_eq!(first.state, second.state);
    let replay = ReplayRequestV1 {
        version: 1,
        mode: ReplayModeV1::MockedEffects,
        artifacts: ArtifactHashesV1 {
            graph: graph.hash().into(),
            pack: "pack-e2e".into(),
            policy: "policy-e2e".into(),
            node_implementation: "control-e2e".into(),
            contract: "v1".into(),
        },
        live_effect_authorization: None,
    };
    replay.validate(&replay.artifacts)?;
    assert!(first
        .events
        .iter()
        .any(|event| matches!(event.kind, EventKindV1::Terminated)));
    println!(
        "{}",
        json!({"pack": loaded.pack.id, "agent": loaded.agent_id, "graph": loaded.graph, "granted_tool_result": success.value, "unauthorized_tool": "denied", "deterministic_replay": true})
    );
    Ok(())
}
