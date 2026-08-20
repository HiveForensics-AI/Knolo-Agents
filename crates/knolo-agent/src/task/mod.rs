use knolo_agent_core::{tool::ToolCallV1, AgentProfileV1, CoreError, ToolId};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::time::Instant;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum TaskActionV1 {
    Report {
        message: String,
    },
    InspectWorkspace,
    ReadFile {
        path: String,
    },
    WriteFile {
        path: String,
        content: String,
    },
    /// Execute one binary directly with arguments. The runtime never invokes
    /// a shell; profiles must grant `process.execute` and the action is gated
    /// by the same explicit approval path as writes.
    ExecuteCommand {
        program: String,
        args: Vec<String>,
    },
}

impl TaskActionV1 {
    pub fn requires_write_approval(&self) -> bool {
        matches!(self, Self::WriteFile { .. } | Self::ExecuteCommand { .. })
    }

    pub fn required_capability(&self) -> Option<&'static str> {
        match self {
            Self::Report { .. } => None,
            Self::InspectWorkspace | Self::ReadFile { .. } => Some("workspace.read"),
            Self::WriteFile { .. } => Some("workspace.write"),
            Self::ExecuteCommand { .. } => Some("process.execute"),
        }
    }

    /// Normalize a planner action before host execution. Policy compilation
    /// can bind these stable IDs to a pack without importing task internals.
    pub fn to_tool_call(&self, call_id: impl Into<String>) -> Result<ToolCallV1, CoreError> {
        let (tool_id, arguments) = match self {
            Self::Report { message } => ("knolo.report", serde_json::json!({"message": message})),
            Self::InspectWorkspace => ("workspace.inspect", serde_json::json!({})),
            Self::ReadFile { path } => ("workspace.read", serde_json::json!({"path": path})),
            Self::WriteFile { path, content } => (
                "workspace.write",
                serde_json::json!({"path": path, "content": content}),
            ),
            Self::ExecuteCommand { program, args } => (
                "process.execute",
                serde_json::json!({"program": program, "args": args}),
            ),
        };
        let call_id = call_id.into();
        if call_id.trim().is_empty() {
            return Err(CoreError::Host("task tool call id cannot be empty".into()));
        }
        Ok(ToolCallV1 {
            version: 1,
            call_id,
            tool_id: ToolId::new(tool_id)?,
            arguments,
        })
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct TaskPlanV1 {
    pub objective: String,
    pub actions: Vec<TaskActionV1>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct TaskObservationV1 {
    pub action: TaskActionV1,
    pub ok: bool,
    pub output: Value,
}

/// A host-provided memory item made available to the planner for one run.
/// Durable storage and authorization remain host responsibilities; this type
/// is only the bounded, serializable context seam.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct TaskMemoryV1 {
    pub namespace: String,
    pub content: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct TaskContextV1 {
    pub task: String,
    pub turn: u32,
    pub observations: Vec<TaskObservationV1>,
    #[serde(default)]
    pub memories: Vec<TaskMemoryV1>,
}

pub trait TaskHost {
    fn plan(
        &mut self,
        profile: &AgentProfileV1,
        context: &TaskContextV1,
    ) -> Result<TaskPlanV1, CoreError>;
    fn execute(
        &mut self,
        profile: &AgentProfileV1,
        action: &TaskActionV1,
    ) -> Result<Value, CoreError>;
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct TaskReportV1 {
    pub status: String,
    pub task: String,
    pub turns: u32,
    pub actions: u32,
    pub observations: Vec<TaskObservationV1>,
}

/// Durable execution state used to continue a paused or interrupted run.
/// The report is intentionally embedded rather than storing host-specific
/// handles, so a new process can validate and resume it safely.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct TaskCheckpointV1 {
    pub version: u16,
    pub task: String,
    pub next_turn: u32,
    pub actions: u32,
    pub observations: Vec<TaskObservationV1>,
}

impl TaskCheckpointV1 {
    pub fn from_report(report: &TaskReportV1) -> Self {
        Self {
            version: 1,
            task: report.task.clone(),
            next_turn: report.turns.saturating_add(1),
            actions: report.actions,
            observations: report.observations.clone(),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct TaskSummaryV1 {
    pub goal: String,
    pub status: String,
    pub actions: u32,
    pub turns: u32,
    pub memory_items: u32,
    pub changed_resources: Vec<String>,
    pub verification_commands: Vec<String>,
    pub unresolved_issues: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum TaskEventKindV1 {
    RunStarted,
    ActionObserved,
    RunFinished,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct TaskEventV1 {
    pub version: u16,
    pub sequence: u64,
    pub kind: TaskEventKindV1,
    pub status: Option<String>,
    pub action: Option<TaskActionV1>,
    pub output: Option<Value>,
}

pub fn events_from_report(report: &TaskReportV1) -> Vec<TaskEventV1> {
    let mut events = vec![TaskEventV1 {
        version: 1,
        sequence: 0,
        kind: TaskEventKindV1::RunStarted,
        status: None,
        action: None,
        output: None,
    }];
    for (index, observation) in report.observations.iter().enumerate() {
        events.push(TaskEventV1 {
            version: 1,
            sequence: index as u64 + 1,
            kind: TaskEventKindV1::ActionObserved,
            status: Some(if observation.ok {
                "ok".into()
            } else {
                "failed".into()
            }),
            action: Some(observation.action.clone()),
            output: Some(observation.output.clone()),
        });
    }
    events.push(TaskEventV1 {
        version: 1,
        sequence: events.len() as u64,
        kind: TaskEventKindV1::RunFinished,
        status: Some(report.status.clone()),
        action: None,
        output: None,
    });
    events
}

impl TaskReportV1 {
    pub fn summary(&self, memory_items: usize) -> TaskSummaryV1 {
        let mut changed_resources = Vec::new();
        let mut verification_commands = Vec::new();
        let mut unresolved_issues = Vec::new();
        for observation in &self.observations {
            match &observation.action {
                TaskActionV1::WriteFile { path, .. } => changed_resources.push(path.clone()),
                TaskActionV1::ExecuteCommand { program, .. } => {
                    verification_commands.push(program.clone())
                }
                _ => {}
            }
            if !observation.ok {
                unresolved_issues.push(observation.output.to_string());
            }
        }
        TaskSummaryV1 {
            goal: self.task.clone(),
            status: self.status.clone(),
            actions: self.actions,
            turns: self.turns,
            memory_items: memory_items as u32,
            changed_resources,
            verification_commands,
            unresolved_issues,
        }
    }
}

pub struct AutonomousTaskRunner<'a, H> {
    pub host: &'a mut H,
    pub profile: &'a AgentProfileV1,
}

impl<'a, H: TaskHost> AutonomousTaskRunner<'a, H> {
    pub fn run(
        &mut self,
        task: impl Into<String>,
        approve: impl FnMut(&TaskActionV1) -> bool,
        cancelled: impl FnMut() -> bool,
    ) -> Result<TaskReportV1, CoreError> {
        self.run_with_memories(task, Vec::new(), approve, cancelled)
    }

    pub fn run_with_memories(
        &mut self,
        task: impl Into<String>,
        memories: Vec<TaskMemoryV1>,
        approve: impl FnMut(&TaskActionV1) -> bool,
        cancelled: impl FnMut() -> bool,
    ) -> Result<TaskReportV1, CoreError> {
        self.run_from_checkpoint(task, memories, None, approve, cancelled)
    }

    pub fn run_from_checkpoint(
        &mut self,
        task: impl Into<String>,
        memories: Vec<TaskMemoryV1>,
        checkpoint: Option<TaskCheckpointV1>,
        mut approve: impl FnMut(&TaskActionV1) -> bool,
        mut cancelled: impl FnMut() -> bool,
    ) -> Result<TaskReportV1, CoreError> {
        self.profile.validate()?;
        let task = task.into();
        let started = Instant::now();
        let (mut observations, mut actions, next_turn) = match checkpoint {
            Some(checkpoint) => {
                if checkpoint.version != 1 {
                    return Err(CoreError::Host(
                        "unsupported task checkpoint version".into(),
                    ));
                }
                if checkpoint.task != task {
                    return Err(CoreError::Host(
                        "task checkpoint does not match the requested task".into(),
                    ));
                }
                (
                    checkpoint.observations,
                    checkpoint.actions,
                    checkpoint.next_turn.max(1),
                )
            }
            None => (Vec::new(), 0, 1),
        };
        for turn in next_turn..=self.profile.autonomy.max_turns {
            if cancelled() {
                return Ok(TaskReportV1 {
                    status: "cancelled".into(),
                    task,
                    turns: turn - 1,
                    actions,
                    observations,
                });
            }
            if started.elapsed().as_millis() as u64 > self.profile.autonomy.timeout_ms {
                return Ok(TaskReportV1 {
                    status: "timed_out".into(),
                    task,
                    turns: turn - 1,
                    actions,
                    observations,
                });
            }
            let context = TaskContextV1 {
                task: task.clone(),
                turn,
                observations: observations.clone(),
                memories: memories.clone(),
            };
            let plan = self.host.plan(self.profile, &context)?;
            if plan.actions.is_empty() {
                return Ok(TaskReportV1 {
                    status: "completed".into(),
                    task,
                    turns: turn,
                    actions,
                    observations,
                });
            }
            for action in plan.actions {
                if actions >= self.profile.autonomy.max_actions {
                    return Ok(TaskReportV1 {
                        status: "action_limit_reached".into(),
                        task,
                        turns: turn,
                        actions,
                        observations,
                    });
                }
                if action.requires_write_approval()
                    && self.profile.autonomy.require_approval_for_writes
                    && !approve(&action)
                {
                    observations.push(TaskObservationV1 {
                        action,
                        ok: false,
                        output: serde_json::json!({"error": "approval denied"}),
                    });
                    return Ok(TaskReportV1 {
                        status: "approval_denied".into(),
                        task,
                        turns: turn,
                        actions,
                        observations,
                    });
                }
                let mut output = self.host.execute(self.profile, &action);
                let mut retries = 0;
                while output.is_err() && retries < self.profile.autonomy.max_retries {
                    retries += 1;
                    output = self.host.execute(self.profile, &action);
                }
                let observation = match output {
                    Ok(output) => TaskObservationV1 {
                        action,
                        ok: true,
                        output,
                    },
                    Err(error) => TaskObservationV1 {
                        action,
                        ok: false,
                        output: serde_json::json!({"error": error.to_string()}),
                    },
                };
                let ok = observation.ok;
                let terminal = matches!(&observation.action, TaskActionV1::Report { .. });
                observations.push(observation);
                actions += 1;
                if !ok {
                    return Ok(TaskReportV1 {
                        status: "failed".into(),
                        task,
                        turns: turn,
                        actions,
                        observations,
                    });
                }
                if terminal {
                    return Ok(TaskReportV1 {
                        status: "completed".into(),
                        task,
                        turns: turn,
                        actions,
                        observations,
                    });
                }
            }
        }
        Ok(TaskReportV1 {
            status: "turn_limit_reached".into(),
            task,
            turns: self.profile.autonomy.max_turns,
            actions,
            observations,
        })
    }
}
