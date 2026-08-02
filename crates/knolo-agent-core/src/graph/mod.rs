use crate::{CoreError, GraphId, NodeId, StateSchemaId, TransitionId};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::collections::{BTreeMap, BTreeSet};

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ExecutionLimitsV1 {
    pub max_steps: u64,
    pub max_tokens: u64,
    pub max_cost_micros: u64,
    pub timeout_ms: u64,
}
impl ExecutionLimitsV1 {
    fn valid(&self) -> bool {
        self.max_steps > 0 && self.timeout_ms > 0
    }
}
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct NodeDefinitionV1 {
    pub id: NodeId,
    pub terminal: bool,
    pub reads: BTreeSet<String>,
    pub writes: BTreeSet<String>,
}
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct TransitionDefinitionV1 {
    pub id: TransitionId,
    pub from: NodeId,
    pub route: String,
    pub to: NodeId,
}
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct CycleDefinitionV1 {
    pub nodes: BTreeSet<NodeId>,
    pub max_iterations: u32,
}
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct GraphDefinitionV1 {
    pub version: u16,
    pub id: GraphId,
    pub state_schema: StateSchemaId,
    pub entry: NodeId,
    pub nodes: Vec<NodeDefinitionV1>,
    pub transitions: Vec<TransitionDefinitionV1>,
    pub cycles: Vec<CycleDefinitionV1>,
    pub limits: ExecutionLimitsV1,
}
#[derive(Debug, Clone)]
pub struct CompiledGraphV1 {
    definition: GraphDefinitionV1,
    nodes: BTreeMap<NodeId, NodeDefinitionV1>,
    routes: BTreeMap<(NodeId, String), NodeId>,
    hash: String,
}
impl GraphDefinitionV1 {
    pub fn validate(&self) -> Result<(), CoreError> {
        if self.version != 1 || !self.limits.valid() {
            return Err(CoreError::InvalidGraph(
                "unsupported version or unbounded limits".into(),
            ));
        }
        let nodes: BTreeMap<_, _> = self.nodes.iter().map(|n| (n.id.clone(), n)).collect();
        if nodes.len() != self.nodes.len() {
            return Err(CoreError::InvalidGraph("duplicate node id".into()));
        }
        if !nodes.contains_key(&self.entry) {
            return Err(CoreError::InvalidGraph("entry node is not declared".into()));
        }
        if !self.nodes.iter().any(|n| n.terminal) {
            return Err(CoreError::InvalidGraph(
                "at least one terminal node is required".into(),
            ));
        }
        let tids: BTreeSet<_> = self.transitions.iter().map(|t| &t.id).collect();
        if tids.len() != self.transitions.len() {
            return Err(CoreError::InvalidGraph("duplicate transition id".into()));
        }
        let mut route_keys = BTreeSet::new();
        for t in &self.transitions {
            if !nodes.contains_key(&t.from) || !nodes.contains_key(&t.to) {
                return Err(CoreError::InvalidGraph(
                    "transition endpoint is not declared".into(),
                ));
            }
            if !route_keys.insert((&t.from, &t.route)) {
                return Err(CoreError::InvalidGraph("duplicate route from node".into()));
            }
        }
        let mut reached = BTreeSet::new();
        let mut stack = vec![self.entry.clone()];
        while let Some(n) = stack.pop() {
            if reached.insert(n.clone()) {
                stack.extend(
                    self.transitions
                        .iter()
                        .filter(|t| t.from == n)
                        .map(|t| t.to.clone()),
                );
            }
        }
        if reached.len() != nodes.len() {
            return Err(CoreError::InvalidGraph("unreachable node".into()));
        }
        for c in &self.cycles {
            if c.max_iterations == 0 || c.nodes.is_empty() {
                return Err(CoreError::InvalidGraph(
                    "cycles must be explicit and bounded".into(),
                ));
            }
        }
        // Every edge whose target can reach its source is part of a declared cycle.
        for t in &self.transitions {
            if can_reach(&t.to, &t.from, &self.transitions)
                && !self
                    .cycles
                    .iter()
                    .any(|c| c.nodes.contains(&t.from) && c.nodes.contains(&t.to))
            {
                return Err(CoreError::InvalidGraph(
                    "cycle is not explicitly declared".into(),
                ));
            }
        }
        Ok(())
    }
    pub fn compile(&self) -> Result<CompiledGraphV1, CoreError> {
        self.validate()?;
        let bytes = serde_json::to_vec(self).map_err(|e| CoreError::InvalidGraph(e.to_string()))?;
        let hash = format!("{:x}", Sha256::digest(bytes));
        Ok(CompiledGraphV1 {
            definition: self.clone(),
            nodes: self
                .nodes
                .iter()
                .cloned()
                .map(|n| (n.id.clone(), n))
                .collect(),
            routes: self
                .transitions
                .iter()
                .map(|t| ((t.from.clone(), t.route.clone()), t.to.clone()))
                .collect(),
            hash,
        })
    }
}
fn can_reach(from: &NodeId, to: &NodeId, ts: &[TransitionDefinitionV1]) -> bool {
    let mut seen = BTreeSet::new();
    let mut s = vec![from.clone()];
    while let Some(n) = s.pop() {
        if &n == to {
            return true;
        }
        if seen.insert(n.clone()) {
            s.extend(ts.iter().filter(|t| t.from == n).map(|t| t.to.clone()));
        }
    }
    false
}
impl CompiledGraphV1 {
    pub fn definition(&self) -> &GraphDefinitionV1 {
        &self.definition
    }
    pub fn node(&self, id: &NodeId) -> Option<&NodeDefinitionV1> {
        self.nodes.get(id)
    }
    pub fn route(&self, from: &NodeId, route: &str) -> Option<&NodeId> {
        self.routes.get(&(from.clone(), route.to_owned()))
    }
    pub fn hash(&self) -> &str {
        &self.hash
    }
    pub fn cycle_limit(&self, node: &NodeId) -> Option<u32> {
        self.definition
            .cycles
            .iter()
            .find(|c| c.nodes.contains(node))
            .map(|c| c.max_iterations)
    }
}
