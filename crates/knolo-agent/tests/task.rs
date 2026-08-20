use knolo_agent::{
    task::{
        AutonomousTaskRunner, TaskActionV1, TaskCheckpointV1, TaskContextV1, TaskHost, TaskPlanV1,
    },
    AgentId, AgentProfileKindV1, AgentProfileV1, CoreError,
};
use serde_json::{json, Value};

struct Host {
    executed: usize,
}

impl TaskHost for Host {
    fn plan(
        &mut self,
        _profile: &AgentProfileV1,
        context: &TaskContextV1,
    ) -> Result<TaskPlanV1, CoreError> {
        Ok(TaskPlanV1 {
            objective: context.task.clone(),
            actions: if context.observations.is_empty() {
                vec![TaskActionV1::Report {
                    message: "done".into(),
                }]
            } else {
                vec![]
            },
        })
    }

    fn execute(
        &mut self,
        _profile: &AgentProfileV1,
        _action: &TaskActionV1,
    ) -> Result<Value, CoreError> {
        self.executed += 1;
        Ok(json!({"ok": true}))
    }
}

#[test]
fn task_runner_replans_until_completion() {
    let profile =
        AgentProfileV1::builtin(AgentProfileKindV1::Custom, AgentId::new("custom").unwrap());
    let mut host = Host { executed: 0 };
    let report = AutonomousTaskRunner {
        host: &mut host,
        profile: &profile,
    }
    .run("test task", |_| true, || false)
    .unwrap();
    assert_eq!(report.status, "completed");
    assert_eq!(report.actions, 1);
    assert_eq!(host.executed, 1);
}

#[test]
fn task_runner_denies_write_without_approval() {
    let mut profile =
        AgentProfileV1::builtin(AgentProfileKindV1::Coding, AgentId::new("coding").unwrap());
    profile.autonomy.require_approval_for_writes = true;
    struct WriteHost;
    impl TaskHost for WriteHost {
        fn plan(
            &mut self,
            _profile: &AgentProfileV1,
            _context: &TaskContextV1,
        ) -> Result<TaskPlanV1, CoreError> {
            Ok(TaskPlanV1 {
                objective: "write".into(),
                actions: vec![TaskActionV1::WriteFile {
                    path: "x".into(),
                    content: "x".into(),
                }],
            })
        }
        fn execute(
            &mut self,
            _profile: &AgentProfileV1,
            _action: &TaskActionV1,
        ) -> Result<Value, CoreError> {
            panic!("denied write must not execute")
        }
    }
    let mut host = WriteHost;
    let report = AutonomousTaskRunner {
        host: &mut host,
        profile: &profile,
    }
    .run("write", |_| false, || false)
    .unwrap();
    assert_eq!(report.status, "approval_denied");
}

#[test]
fn task_actions_normalize_to_stable_tool_calls() {
    let action = TaskActionV1::WriteFile {
        path: "notes.txt".into(),
        content: "hello".into(),
    };
    let call = action.to_tool_call("turn-1-action-1").unwrap();
    assert_eq!(call.tool_id.as_str(), "workspace.write");
    assert_eq!(call.arguments["path"], "notes.txt");
    assert_eq!(action.required_capability(), Some("workspace.write"));
    assert!(action.to_tool_call("").is_err());
}

#[test]
fn task_checkpoint_resumes_with_prior_observations() {
    let profile =
        AgentProfileV1::builtin(AgentProfileKindV1::Custom, AgentId::new("custom").unwrap());
    let mut host = Host { executed: 0 };
    let first = AutonomousTaskRunner {
        host: &mut host,
        profile: &profile,
    }
    .run("checkpoint task", |_| true, || false)
    .unwrap();
    let checkpoint = TaskCheckpointV1::from_report(&first);
    let resumed = AutonomousTaskRunner {
        host: &mut host,
        profile: &profile,
    }
    .run_from_checkpoint(
        "checkpoint task",
        Vec::new(),
        Some(checkpoint),
        |_| true,
        || false,
    )
    .unwrap();
    assert_eq!(resumed.status, "completed");
    assert_eq!(resumed.actions, first.actions);
    assert_eq!(resumed.turns, first.turns + 1);
    assert_eq!(host.executed, 1);
}
