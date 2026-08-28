//! Knolo's small, host-local product entry point.
//!
//! This binary intentionally uses only the existing runtime crate dependencies.
//! Model providers can be added as host adapters without changing the CLI's
//! profile, policy, task, or event contracts.

use knolo_agent::{
    memory::LocalMemoryStore,
    model::{ModelConfigV1, ModelProviderV1, OpenAiCompatiblePlanner},
    task::{
        events_from_report, AutonomousTaskRunner, TaskActionV1, TaskCheckpointV1, TaskContextV1,
        TaskEventV1, TaskHost, TaskPlanV1, TaskReportV1, TaskSummaryV1,
    },
    workspace::{LocalWorkspaceHost, WorkspaceHost},
    AgentId, AgentProfileKindV1, AgentProfileV1, CoreError,
};
use serde_json::{json, Value};
use std::{
    env,
    fs::{self, File},
    io::{self, Write},
    path::PathBuf,
    process::{Command, Stdio},
    time::{SystemTime, UNIX_EPOCH},
};

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let args: Vec<String> = env::args().skip(1).collect();
    match args.first().map(String::as_str) {
        None | Some("help") | Some("--help") | Some("-h") => print_help(),
        Some("--version") | Some("version") => println!("knolo 0.2.0"),
        Some("init") => init()?,
        Some("doctor") => doctor(&args[1..])?,
        Some("memory") => memory_command(&args[1..])?,
        Some("agent") => agent_command(&args[1..])?,
        Some("model") => model_command(&args[1..])?,
        Some("run") => run_command(&args[1..])?,
        Some("session") => session_command(&args[1..])?,
        Some(other) => return Err(format!("unknown command `{other}`; use `knolo help`").into()),
    }
    Ok(())
}

fn print_help() {
    println!(
        "Knolo — governed autonomous agents\n\n\
         Usage:\n  \
         knolo init\n  \
         knolo doctor [--model <model-id>]\n  \
         knolo memory list <agent-id>\n  \
         knolo memory add <agent-id> --namespace <namespace> [--source <source>] <text>\n  \
         knolo agent list\n  \
         knolo agent create --template <coding|research|operations|custom> [--model <model-id>] <id>\n  \
         knolo agent set-model <agent-id> <model-id>\n  \
         knolo agent inspect <id>\n  \
         knolo model add <id> --provider <ollama|openai-compatible> --model <name> [--base-url <url>]\n  \
         knolo model list|inspect|remove\n  \
         knolo agent run --agent <id> <task>\n  \
         knolo run --agent <id> [--model <id>] [--headless] [--yes] [--plan-command <path>] <task>\n  \
         knolo session list|logs|replay|export|resume|pause|stop <id>\n\n\
         `knolo run` executes a bounded task loop. Host model and tool adapters\n\
         use explicit providers, models, capabilities, and approvals."
    );
}

fn data_dir() -> PathBuf {
    env::var_os("KNOLO_HOME")
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from(".knolo"))
}

fn agents_dir() -> PathBuf {
    data_dir().join("agents")
}

fn models_dir() -> PathBuf {
    data_dir().join("models")
}

fn sessions_dir() -> PathBuf {
    data_dir().join("sessions")
}

fn init() -> Result<(), Box<dyn std::error::Error>> {
    fs::create_dir_all(agents_dir())?;
    println!("Initialized Knolo in {}", data_dir().display());
    println!("Try: knolo agent list");
    Ok(())
}

fn doctor(args: &[String]) -> Result<(), Box<dyn std::error::Error>> {
    let mut model_id = None;
    let mut index = 0;
    while index < args.len() {
        match args[index].as_str() {
            "--model" => {
                model_id = Some(args.get(index + 1).ok_or("missing model id")?.clone());
                index += 2;
            }
            other => return Err(format!("unknown doctor argument: {other}").into()),
        }
    }

    fs::create_dir_all(agents_dir())?;
    fs::create_dir_all(models_dir())?;
    fs::create_dir_all(sessions_dir())?;
    println!("ok   Knolo data directory: {}", data_dir().display());

    let selected_model = match model_id {
        Some(id) => Some(load_model_config(&id)?),
        None => {
            let mut configured = Vec::new();
            if models_dir().exists() {
                for entry in fs::read_dir(models_dir())? {
                    let path = entry?.path();
                    if path.extension().and_then(|value| value.to_str()) == Some("json") {
                        configured.push(serde_json::from_reader(File::open(path)?)?);
                    }
                }
            }
            configured
                .sort_by(|left: &ModelConfigV1, right: &ModelConfigV1| left.id.cmp(&right.id));
            configured.into_iter().next()
        }
    };

    let Some(config) = selected_model else {
        println!(
            "warn no model configured; run knolo model add local --provider ollama --model <name>"
        );
        println!("ready Knolo CLI checks passed; configure a model before autonomous runs");
        return Ok(());
    };

    let planner = OpenAiCompatiblePlanner::new(config.clone())?;
    match planner.health_check() {
        Ok(()) => {
            println!(
                "ok   model endpoint: {} ({}/{})",
                config.base_url, config.provider, config.model
            );
            println!("ready local model is reachable");
            Ok(())
        }
        Err(error) => {
            println!(
                "fail model endpoint: {} ({}/{})",
                config.base_url, config.provider, config.model
            );
            Err(error.into())
        }
    }
}

fn memory_command(args: &[String]) -> Result<(), Box<dyn std::error::Error>> {
    let operation = args.first().map(String::as_str);
    let agent = args
        .get(1)
        .ok_or("usage: knolo memory list|add <agent-id>")?;
    let profile = load_profile(agent)?;
    let store = LocalMemoryStore::new(data_dir().join("memory"));
    match operation {
        Some("list") => {
            println!("{}", serde_json::to_string_pretty(&store.list(&profile)?)?);
        }
        Some("add") => {
            let mut namespace = None;
            let mut source = "cli".to_owned();
            let mut content = Vec::new();
            let mut index = 2;
            while index < args.len() {
                match args[index].as_str() {
                    "--namespace" => {
                        namespace = Some(args.get(index + 1).ok_or("missing namespace")?.clone());
                        index += 2;
                    }
                    "--source" => {
                        source = args.get(index + 1).ok_or("missing source")?.clone();
                        index += 2;
                    }
                    _ => {
                        content.extend(args[index..].iter().cloned());
                        break;
                    }
                }
            }
            let namespace = namespace.ok_or("memory add requires --namespace <namespace>")?;
            let content = content.join(" ");
            let reference = store.remember(&profile, &namespace, &content, &source)?;
            println!("{}", serde_json::to_string_pretty(&reference)?);
        }
        _ => return Err("usage: knolo memory list|add <agent-id> ...".into()),
    }
    Ok(())
}

fn agent_command(args: &[String]) -> Result<(), Box<dyn std::error::Error>> {
    match args.first().map(String::as_str) {
        Some("list") => {
            println!(
                "coding\tCoding Agent\nresearch\tResearch Agent\noperations\tOperations Agent"
            );
            if agents_dir().exists() {
                for entry in fs::read_dir(agents_dir())? {
                    let path = entry?.path();
                    if path.extension().and_then(|v| v.to_str()) == Some("json") {
                        if let Some(id) = path.file_stem().and_then(|v| v.to_str()) {
                            println!("{id}\tcustom profile");
                        }
                    }
                }
            }
        }
        Some("create") => create_agent(&args[1..])?,
        Some("set-model") => set_agent_model(&args[1..])?,
        Some("run") => run_command(&args[1..])?,
        Some("resume") => {
            let id = args
                .get(1)
                .ok_or("usage: knolo agent resume <session-id>")?;
            session_command(&["resume".into(), id.clone()])?
        }
        Some("logs") => {
            let id = args.get(1).ok_or("usage: knolo agent logs <session-id>")?;
            session_command(&["logs".into(), id.clone()])?
        }
        Some("stop") => {
            let id = args.get(1).ok_or("usage: knolo agent stop <session-id>")?;
            session_command(&["stop".into(), id.clone()])?
        }
        Some("inspect") => {
            let id = args.get(1).ok_or("usage: knolo agent inspect <id>")?;
            let profile = load_profile(id)?;
            println!("{}", serde_json::to_string_pretty(&profile)?);
        }
        _ => return Err("usage: knolo agent list|create|set-model|inspect".into()),
    }
    Ok(())
}

fn create_agent(args: &[String]) -> Result<(), Box<dyn std::error::Error>> {
    let mut template = "custom";
    let mut model = None;
    let mut id = None;
    let mut index = 0;
    while index < args.len() {
        match args[index].as_str() {
            "--template" => {
                template = args.get(index + 1).ok_or("missing template")?;
                index += 2;
            }
            "--model" => {
                model = Some(args.get(index + 1).ok_or("missing model id")?.to_owned());
                index += 2;
            }
            value if !value.starts_with('-') && id.is_none() => {
                id = Some(value.to_owned());
                index += 1;
            }
            other => return Err(format!("unknown create argument `{other}`").into()),
        }
    }
    let id = id.ok_or("usage: knolo agent create --template <kind> <id>")?;
    if let Some(model_id) = &model {
        load_model_config(model_id)?;
    }
    let mut profile = AgentProfileV1::builtin(parse_kind(template)?, AgentId::new(id.clone())?);
    profile.model = model;
    profile.validate()?;
    fs::create_dir_all(agents_dir())?;
    let path = agents_dir().join(format!("{id}.json"));
    let mut file = File::create(&path)?;
    file.write_all(serde_json::to_string_pretty(&profile)?.as_bytes())?;
    println!("Created {}", path.display());
    Ok(())
}

fn set_agent_model(args: &[String]) -> Result<(), Box<dyn std::error::Error>> {
    let agent = args
        .first()
        .ok_or("usage: knolo agent set-model <agent-id> <model-id>")?;
    let model = args
        .get(1)
        .ok_or("usage: knolo agent set-model <agent-id> <model-id>")?;
    if matches!(agent.as_str(), "coding" | "research" | "operations") {
        return Err("built-in profiles cannot be edited; create a named profile first".into());
    }
    load_model_config(model)?;
    let mut profile = load_profile(agent)?;
    profile.model = Some(model.clone());
    profile.validate()?;
    fs::write(
        agents_dir().join(format!("{agent}.json")),
        serde_json::to_vec_pretty(&profile)?,
    )?;
    println!("Set model {model} for agent {agent}");
    Ok(())
}

fn parse_kind(value: &str) -> Result<AgentProfileKindV1, Box<dyn std::error::Error>> {
    match value {
        "coding" => Ok(AgentProfileKindV1::Coding),
        "research" => Ok(AgentProfileKindV1::Research),
        "operations" => Ok(AgentProfileKindV1::Operations),
        "custom" => Ok(AgentProfileKindV1::Custom),
        _ => Err(format!("unknown profile template `{value}`").into()),
    }
}

fn load_profile(id: &str) -> Result<AgentProfileV1, Box<dyn std::error::Error>> {
    let kind = match id {
        "coding" => Some(AgentProfileKindV1::Coding),
        "research" => Some(AgentProfileKindV1::Research),
        "operations" => Some(AgentProfileKindV1::Operations),
        _ => None,
    };
    if let Some(kind) = kind {
        return Ok(AgentProfileV1::builtin(kind, AgentId::new(id.to_owned())?));
    }
    let path = agents_dir().join(format!("{id}.json"));
    let profile: AgentProfileV1 = serde_json::from_reader(File::open(path)?)?;
    profile.validate()?;
    Ok(profile)
}

fn model_path(id: &str) -> Result<PathBuf, Box<dyn std::error::Error>> {
    if id.is_empty() || id == "." || id == ".." || id.contains('/') || id.contains('\\') {
        return Err("model id must be a simple name".into());
    }
    Ok(models_dir().join(format!("{id}.json")))
}

fn load_model_config(id: &str) -> Result<ModelConfigV1, Box<dyn std::error::Error>> {
    let config: ModelConfigV1 = serde_json::from_reader(File::open(model_path(id)?)?)?;
    config.validate()?;
    Ok(config)
}

fn model_command(args: &[String]) -> Result<(), Box<dyn std::error::Error>> {
    match args.first().map(String::as_str) {
        Some("list") => {
            if !models_dir().exists() {
                return Ok(());
            }
            for entry in fs::read_dir(models_dir())? {
                let path = entry?.path();
                if path.extension().and_then(|value| value.to_str()) == Some("json") {
                    let config: ModelConfigV1 = serde_json::from_reader(File::open(&path)?)?;
                    println!(
                        "{}\t{}\t{}\t{}",
                        config.id, config.provider, config.model, config.base_url
                    );
                }
            }
        }
        Some("inspect") => {
            let id = args.get(1).ok_or("usage: knolo model inspect <id>")?;
            println!("{}", serde_json::to_string_pretty(&load_model_config(id)?)?);
        }
        Some("remove") => {
            let id = args.get(1).ok_or("usage: knolo model remove <id>")?;
            fs::remove_file(model_path(id)?)?;
            println!("Removed model {id}");
        }
        Some("add") => add_model(&args[1..])?,
        _ => return Err("usage: knolo model add|list|inspect|remove".into()),
    }
    Ok(())
}

fn add_model(args: &[String]) -> Result<(), Box<dyn std::error::Error>> {
    let id = args
        .first()
        .ok_or("usage: knolo model add <id> --model <name>")?;
    model_path(id)?;
    let mut provider = "ollama".to_owned();
    let mut model = None;
    let mut base_url = None;
    let mut api_key_env = None;
    let mut temperature = 0.0;
    let mut max_tokens = 2048;
    let mut index = 1;
    while index < args.len() {
        match args[index].as_str() {
            "--provider" => {
                provider = args.get(index + 1).ok_or("missing provider")?.clone();
                index += 2;
            }
            "--model" => {
                model = Some(args.get(index + 1).ok_or("missing model name")?.clone());
                index += 2;
            }
            "--base-url" => {
                base_url = Some(args.get(index + 1).ok_or("missing base URL")?.clone());
                index += 2;
            }
            "--api-key-env" => {
                api_key_env = Some(
                    args.get(index + 1)
                        .ok_or("missing environment variable")?
                        .clone(),
                );
                index += 2;
            }
            "--temperature" => {
                temperature = args.get(index + 1).ok_or("missing temperature")?.parse()?;
                index += 2;
            }
            "--max-tokens" => {
                max_tokens = args.get(index + 1).ok_or("missing max tokens")?.parse()?;
                index += 2;
            }
            other => return Err(format!("unknown model argument `{other}`").into()),
        }
    }
    let model = model.ok_or("missing --model <name>")?;
    let default_base_url = ModelProviderV1::parse(&provider)?.default_base_url();
    let config = ModelConfigV1 {
        version: 1,
        id: id.clone(),
        provider,
        model,
        base_url: base_url.unwrap_or_else(|| default_base_url.into()),
        api_key_env,
        temperature,
        max_tokens,
    };
    config.validate()?;
    fs::create_dir_all(models_dir())?;
    fs::write(model_path(id)?, serde_json::to_vec_pretty(&config)?)?;
    println!("Added model {} ({})", config.id, config.model);
    Ok(())
}

fn run_command(args: &[String]) -> Result<(), Box<dyn std::error::Error>> {
    let mut agent = "coding".to_owned();
    let mut headless = false;
    let mut approve_writes = false;
    let mut plan_command = None;
    let mut model_override = None;
    let mut session_id = None;
    let mut resume_session = None;
    let mut task = Vec::new();
    let mut index = 0;
    while index < args.len() {
        match args[index].as_str() {
            "--agent" => {
                agent = args.get(index + 1).ok_or("missing agent id")?.clone();
                index += 2;
            }
            "--headless" => {
                headless = true;
                index += 1;
            }
            "--yes" => {
                approve_writes = true;
                index += 1;
            }
            "--plan-command" => {
                plan_command = Some(PathBuf::from(
                    args.get(index + 1).ok_or("missing plan command")?,
                ));
                index += 2;
            }
            "--model" => {
                model_override = Some(args.get(index + 1).ok_or("missing model id")?.clone());
                index += 2;
            }
            "--session-id" => {
                session_id = Some(args.get(index + 1).ok_or("missing session id")?.clone());
                index += 2;
            }
            "--resume-session" => {
                resume_session = Some(args.get(index + 1).ok_or("missing session id")?.clone());
                index += 2;
            }
            _value => {
                task.extend(args[index..].iter().cloned());
                break;
            }
        }
    }
    if task.is_empty() {
        return Err("usage: knolo run --agent <id> [--headless] [--yes] <task>".into());
    }
    let profile = load_profile(&agent)?;
    if plan_command.is_some() && model_override.is_some() {
        return Err("use either --plan-command or --model, not both".into());
    }
    let model_id = model_override.or_else(|| profile.model.clone());
    let model = model_id.as_deref().map(load_model_config).transpose()?;
    let session_id = session_id.unwrap_or_else(new_session_id);
    fs::create_dir_all(sessions_dir())?;
    let stop_path = sessions_dir().join(format!("{session_id}.stop"));
    let pause_path = sessions_dir().join(format!("{session_id}.pause"));
    let mut host = ProductTaskHost {
        local: LocalTaskHost::new(env::current_dir()?),
        plan_command,
        model: model.map(OpenAiCompatiblePlanner::new).transpose()?,
    };
    let mut runner = AutonomousTaskRunner {
        host: &mut host,
        profile: &profile,
    };
    let task_text = task.join(" ");
    let memories = LocalMemoryStore::new(data_dir().join("memory")).recall(&profile, &task_text)?;
    let memory_count = memories.len();
    let checkpoint = resume_session
        .as_deref()
        .map(|id| sessions_dir().join(format!("{id}.json")))
        .map(File::open)
        .transpose()?
        .map(
            |file| -> Result<TaskCheckpointV1, Box<dyn std::error::Error>> {
                let record: SessionRecord = serde_json::from_reader(file)?;
                Ok(record
                    .checkpoint
                    .unwrap_or_else(|| TaskCheckpointV1::from_report(&record.report)))
            },
        )
        .transpose()?;
    let mut report = runner.run_from_checkpoint(
        task_text.clone(),
        memories,
        checkpoint,
        |action| {
            if approve_writes || headless {
                return approve_writes;
            }
            println!("Agent requests approval for: {action:?}");
            print!("Approve? [y/N] ");
            let _ = io::stdout().flush();
            let mut answer = String::new();
            io::stdin().read_line(&mut answer).is_ok()
                && matches!(answer.trim().to_ascii_lowercase().as_str(), "y" | "yes")
        },
        || stop_path.exists() || pause_path.exists(),
    )?;
    let paused = pause_path.exists() && !stop_path.exists() && report.status == "cancelled";
    if paused {
        report.status = "paused".into();
    }
    let summary = report.summary(memory_count);
    let events = events_from_report(&report);
    let session = SessionRecord {
        id: session_id.clone(),
        agent: agent.clone(),
        task: task.join(" "),
        report: report.clone(),
        checkpoint: Some(TaskCheckpointV1::from_report(&report)),
        summary: Some(summary.clone()),
        events: Some(events),
    };
    fs::write(
        sessions_dir().join(format!("{session_id}.json")),
        serde_json::to_vec_pretty(&session)?,
    )?;
    let _ = fs::remove_file(stop_path);
    if !paused {
        let _ = fs::remove_file(pause_path);
    }
    if headless {
        println!(
            "{}",
            serde_json::to_string_pretty(&RunOutput { report, summary })?
        );
    } else {
        println!(
            "status: {} ({} action(s), {} turn(s))",
            report.status, report.actions, report.turns
        );
        for observation in report.observations {
            println!("- {:?}: {}", observation.action, observation.output);
        }
    }
    Ok(())
}

#[derive(serde::Serialize, serde::Deserialize)]
struct SessionRecord {
    id: String,
    agent: String,
    task: String,
    report: TaskReportV1,
    #[serde(default)]
    checkpoint: Option<TaskCheckpointV1>,
    #[serde(default)]
    summary: Option<TaskSummaryV1>,
    #[serde(default)]
    events: Option<Vec<TaskEventV1>>,
}

#[derive(serde::Serialize)]
struct RunOutput {
    report: TaskReportV1,
    summary: TaskSummaryV1,
}

fn new_session_id() -> String {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis().to_string())
        .unwrap_or_else(|_| "session-unknown".into())
}

fn session_command(args: &[String]) -> Result<(), Box<dyn std::error::Error>> {
    match args.first().map(String::as_str) {
        Some("list") => {
            if !sessions_dir().exists() {
                return Ok(());
            }
            for entry in fs::read_dir(sessions_dir())? {
                let path = entry?.path();
                if path.extension().and_then(|value| value.to_str()) == Some("json") {
                    if let Some(id) = path.file_stem().and_then(|value| value.to_str()) {
                        let status =
                            serde_json::from_reader::<_, SessionRecord>(File::open(&path)?)
                                .map(|record| record.report.status)
                                .unwrap_or_else(|_| "unreadable".into());
                        println!("{id}\t{status}");
                    }
                }
            }
        }
        Some("logs") => {
            let id = args.get(1).ok_or("usage: knolo session logs <id>")?;
            let record: SessionRecord =
                serde_json::from_reader(File::open(sessions_dir().join(format!("{id}.json")))?)?;
            println!("{}", serde_json::to_string_pretty(&record)?);
        }
        Some("replay") | Some("export") => {
            let id = args
                .get(1)
                .ok_or("usage: knolo session replay|export <id>")?;
            let record: SessionRecord =
                serde_json::from_reader(File::open(sessions_dir().join(format!("{id}.json")))?)?;
            if args[0] == "replay" {
                println!("replay {}: {}", record.id, record.report.status);
                if let Some(events) = record.events {
                    for event in events {
                        println!(
                            "#{} {:?} {}",
                            event.sequence,
                            event.kind,
                            event.status.unwrap_or_else(|| "pending".into())
                        );
                    }
                } else {
                    for (sequence, observation) in record.report.observations.iter().enumerate() {
                        println!(
                            "#{sequence} {} {:?}",
                            if observation.ok { "ok" } else { "failed" },
                            observation.action
                        );
                    }
                }
                if let Some(summary) = record.summary {
                    println!("{}", serde_json::to_string_pretty(&summary)?);
                }
            } else {
                println!("{}", serde_json::to_string_pretty(&record)?);
            }
        }
        Some("resume") => {
            let id = args.get(1).ok_or("usage: knolo session resume <id>")?;
            let record: SessionRecord =
                serde_json::from_reader(File::open(sessions_dir().join(format!("{id}.json")))?)?;
            let _ = fs::remove_file(sessions_dir().join(format!("{id}.pause")));
            run_command(&[
                "--agent".into(),
                record.agent,
                "--session-id".into(),
                record.id,
                "--resume-session".into(),
                id.clone(),
                record.task,
            ])?;
        }
        Some("pause") => {
            let id = args.get(1).ok_or("usage: knolo session pause <id>")?;
            fs::create_dir_all(sessions_dir())?;
            File::create(sessions_dir().join(format!("{id}.pause")))?;
            println!("Pause requested for session {id}");
        }
        Some("stop") => {
            let id = args.get(1).ok_or("usage: knolo session stop <id>")?;
            fs::create_dir_all(sessions_dir())?;
            File::create(sessions_dir().join(format!("{id}.stop")))?;
            println!("Stop requested for session {id}");
        }
        _ => {
            return Err(
                "usage: knolo session list|logs|replay|export|resume|pause|stop <id>".into(),
            )
        }
    }
    Ok(())
}

struct LocalTaskHost {
    workspace: LocalWorkspaceHost,
}

struct ProductTaskHost {
    local: LocalTaskHost,
    plan_command: Option<PathBuf>,
    model: Option<OpenAiCompatiblePlanner>,
}

impl TaskHost for ProductTaskHost {
    fn plan(
        &mut self,
        profile: &AgentProfileV1,
        context: &TaskContextV1,
    ) -> Result<TaskPlanV1, CoreError> {
        if let Some(model) = &self.model {
            return model.plan(profile, context);
        }
        let Some(command) = &self.plan_command else {
            return self.local.plan(profile, context);
        };
        let request = serde_json::to_vec(&json!({
            "profile": profile,
            "context": context,
        }))
        .map_err(|error| CoreError::Host(error.to_string()))?;
        let mut child = Command::new(command)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .map_err(|error| CoreError::Host(format!("plan command: {error}")))?;
        child
            .stdin
            .as_mut()
            .ok_or_else(|| CoreError::Host("plan command stdin unavailable".into()))?
            .write_all(&request)
            .map_err(|error| CoreError::Host(format!("plan command stdin: {error}")))?;
        let output = child
            .wait_with_output()
            .map_err(|error| CoreError::Host(format!("plan command: {error}")))?;
        if !output.status.success() {
            return Err(CoreError::Host(format!(
                "plan command exited with {}: {}",
                output.status,
                String::from_utf8_lossy(&output.stderr)
            )));
        }
        serde_json::from_slice(&output.stdout)
            .map_err(|error| CoreError::Host(format!("invalid TaskPlanV1: {error}")))
    }

    fn execute(
        &mut self,
        profile: &AgentProfileV1,
        action: &TaskActionV1,
    ) -> Result<Value, CoreError> {
        self.local.execute(profile, action)
    }
}

impl LocalTaskHost {
    fn new(workspace: PathBuf) -> Self {
        Self {
            workspace: LocalWorkspaceHost::new(workspace),
        }
    }

    fn allowed(profile: &AgentProfileV1, capability: &str) -> Result<(), CoreError> {
        if profile.capabilities.iter().any(|item| item == capability) {
            Ok(())
        } else {
            Err(CoreError::PolicyDenied(
                knolo_agent::policy::PolicyDenialV1 {
                    version: 1,
                    code: knolo_agent::policy::PolicyDenialCodeV1::CapabilityUnavailable,
                    tool_id: None,
                    namespace: None,
                    message: format!("profile does not grant {capability}"),
                },
            ))
        }
    }
}

impl TaskHost for LocalTaskHost {
    fn plan(
        &mut self,
        _profile: &AgentProfileV1,
        context: &TaskContextV1,
    ) -> Result<TaskPlanV1, CoreError> {
        if !context.observations.is_empty() {
            return Ok(TaskPlanV1 {
                objective: context.task.clone(),
                actions: Vec::new(),
            });
        }
        let task = context.task.trim();
        let actions = if task.eq_ignore_ascii_case("list files")
            || task.eq_ignore_ascii_case("inspect workspace")
        {
            vec![TaskActionV1::InspectWorkspace]
        } else if let Some(path) = task.strip_prefix("read ") {
            vec![TaskActionV1::ReadFile {
                path: path.trim().into(),
            }]
        } else if let Some(rest) = task.strip_prefix("write ") {
            let (path, content) = rest
                .split_once(' ')
                .ok_or_else(|| CoreError::Host("write syntax: write <path> <content>".into()))?;
            vec![TaskActionV1::WriteFile {
                path: path.into(),
                content: content.into(),
            }]
        } else {
            vec![TaskActionV1::Report {
                message: format!(
                    "No built-in plan matched this task. Use `list files`, `read <path>`, or `write <path> <content>`, or connect a model host adapter. Task: {task}"
                ),
            }]
        };
        Ok(TaskPlanV1 {
            objective: task.into(),
            actions,
        })
    }

    fn execute(
        &mut self,
        profile: &AgentProfileV1,
        action: &TaskActionV1,
    ) -> Result<Value, CoreError> {
        match action {
            TaskActionV1::Report { message } => Ok(json!({"message": message})),
            TaskActionV1::InspectWorkspace => {
                Self::allowed(profile, "workspace.read")?;
                self.workspace.inspect()
            }
            TaskActionV1::ReadFile { path } => {
                Self::allowed(profile, "workspace.read")?;
                self.workspace.read_file(path)
            }
            TaskActionV1::WriteFile { path, content } => {
                Self::allowed(profile, "workspace.write")?;
                self.workspace.write_file(path, content)
            }
            TaskActionV1::ExecuteCommand { program, args } => {
                Self::allowed(profile, "process.execute")?;
                self.workspace.execute(program, args)
            }
        }
    }
}
