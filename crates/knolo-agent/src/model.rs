//! Provider-neutral model configuration and OpenAI-compatible planning.
//!
//! Local runtimes such as Ollama, LM Studio, llama.cpp, and vLLM can expose an
//! OpenAI-compatible HTTP endpoint. Keeping the adapter here means the agent
//! runtime can use those models without embedding a vendor-specific SDK.

use knolo_agent_core::{AgentProfileV1, CoreError};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{collections::BTreeMap, env, time::Duration};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ModelProviderV1 {
    Ollama,
    LmStudio,
    LlamaCpp,
    Vllm,
    OpenAiCompatible,
}

impl ModelProviderV1 {
    pub fn parse(value: &str) -> Result<Self, CoreError> {
        match value {
            "ollama" => Ok(Self::Ollama),
            "lmstudio" => Ok(Self::LmStudio),
            "llama-cpp" => Ok(Self::LlamaCpp),
            "vllm" => Ok(Self::Vllm),
            "openai-compatible" => Ok(Self::OpenAiCompatible),
            _ => Err(CoreError::Host(format!(
                "unsupported model provider: {value}"
            ))),
        }
    }

    pub fn default_base_url(self) -> &'static str {
        match self {
            Self::Ollama => "http://127.0.0.1:11434/v1",
            Self::LmStudio => "http://127.0.0.1:1234/v1",
            Self::LlamaCpp | Self::Vllm => "http://127.0.0.1:8000/v1",
            Self::OpenAiCompatible => "https://api.openai.com/v1",
        }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ModelConfigV1 {
    pub version: u16,
    pub id: String,
    /// A user-facing provider label. The current adapter uses the
    /// OpenAI-compatible chat-completions protocol for all values.
    pub provider: String,
    pub model: String,
    pub base_url: String,
    /// The environment variable name containing the credential. The secret is
    /// deliberately never written to the Knolo configuration directory.
    pub api_key_env: Option<String>,
    pub temperature: f32,
    pub max_tokens: u32,
}

impl ModelConfigV1 {
    pub fn validate(&self) -> Result<(), CoreError> {
        if self.version != 1 {
            return Err(CoreError::Host("unsupported model config version".into()));
        }
        if self.id.trim().is_empty()
            || self.provider.trim().is_empty()
            || self.model.trim().is_empty()
            || self.base_url.trim().is_empty()
        {
            return Err(CoreError::Host(
                "model id, provider, model, and base_url are required".into(),
            ));
        }
        if !(0.0..=2.0).contains(&self.temperature) || self.max_tokens == 0 {
            return Err(CoreError::Host(
                "temperature must be between 0 and 2 and max_tokens must be positive".into(),
            ));
        }
        ModelProviderV1::parse(&self.provider)?;
        Ok(())
    }

    pub fn endpoint(&self) -> String {
        format!("{}/chat/completions", self.base_url.trim_end_matches('/'))
    }

    pub fn provider_kind(&self) -> Result<ModelProviderV1, CoreError> {
        ModelProviderV1::parse(&self.provider)
    }
}

/// One registry is shared by CLI/headless/native hosts. It contains metadata
/// only; credentials remain in the environment and are never serialized here.
#[derive(Debug, Default)]
pub struct ModelRegistryV1 {
    configs: BTreeMap<String, ModelConfigV1>,
}

impl ModelRegistryV1 {
    pub fn new(configs: impl IntoIterator<Item = ModelConfigV1>) -> Result<Self, CoreError> {
        let mut registry = Self::default();
        for config in configs {
            config.validate()?;
            if registry.configs.insert(config.id.clone(), config).is_some() {
                return Err(CoreError::Host("duplicate model id".into()));
            }
        }
        Ok(registry)
    }

    pub fn get(&self, id: &str) -> Option<&ModelConfigV1> {
        self.configs.get(id)
    }

    pub fn list(&self) -> impl Iterator<Item = &ModelConfigV1> {
        self.configs.values()
    }
}

pub struct OpenAiCompatiblePlanner {
    config: ModelConfigV1,
}

impl OpenAiCompatiblePlanner {
    pub fn new(config: ModelConfigV1) -> Result<Self, CoreError> {
        config.validate()?;
        Ok(Self { config })
    }

    pub fn config(&self) -> &ModelConfigV1 {
        &self.config
    }

    /// Check that the configured OpenAI-compatible host is reachable without
    /// sending a task or storing credentials. Local providers expose the
    /// standard /models endpoint, which is enough for knolo doctor.
    pub fn health_check(&self) -> Result<(), CoreError> {
        let client = reqwest::blocking::Client::builder()
            .timeout(Duration::from_secs(5))
            .build()
            .map_err(|error| CoreError::Host(format!("model client: {error}")))?;
        let mut request = client.get(format!(
            "{}/models",
            self.config.base_url.trim_end_matches('/')
        ));
        if let Some(environment_variable) = &self.config.api_key_env {
            let key = env::var(environment_variable).map_err(|_| {
                CoreError::Host(format!(
                    "model credential is missing; set {environment_variable}"
                ))
            })?;
            request = request.bearer_auth(key);
        }
        let response = request
            .send()
            .map_err(|error| CoreError::Host(format!("model health check: {error}")))?;
        if !response.status().is_success() {
            return Err(CoreError::Host(format!(
                "model health check failed with {}",
                response.status()
            )));
        }
        Ok(())
    }

    pub fn plan(
        &self,
        profile: &AgentProfileV1,
        context: &crate::task::TaskContextV1,
    ) -> Result<crate::task::TaskPlanV1, CoreError> {
        let client = reqwest::blocking::Client::builder()
            .timeout(Duration::from_millis(profile.autonomy.timeout_ms))
            .build()
            .map_err(|error| CoreError::Host(format!("model client: {error}")))?;
        let latest_observation = context
            .observations
            .last()
            .map(serde_json::to_string)
            .transpose()
            .map_err(|error| CoreError::Host(format!("model observation: {error}")))?
            .unwrap_or_else(|| "none".into());
        let memories = if context.memories.is_empty() {
            "none".to_owned()
        } else {
            context
                .memories
                .iter()
                .map(|memory| format!("[{}] {}", memory.namespace, memory.content))
                .collect::<Vec<_>>()
                .join("\n")
        };
        let prompt = format!(
            "Task: {}\nTurn: {}\nCapabilities: {}\nRelevant memory:\n{}\nLatest result: {}\nReturn JSON.",
            context.task,
            context.turn,
            profile.capabilities.join(", "),
            memories,
            latest_observation,
        );
        let mut body = json!({
            "model": self.config.model,
            "temperature": self.config.temperature,
            "max_tokens": self.config.max_tokens,
            "messages": [
                {"role": "system", "content": planning_system_prompt()},
                {"role": "user", "content": prompt},
            ]
        });

        let mut payload = self.complete(&client, &body)?;
        let mut content = payload
            .pointer("/choices/0/message/content")
            .and_then(Value::as_str)
            .filter(|value| !value.trim().is_empty());
        // Some compact local models spend their larger output budget on hidden
        // reasoning and return an empty visible message. A short retry is
        // enough for the bounded JSON plan and keeps the default config useful
        // without weakening validation.
        if content.is_none() && self.config.max_tokens > 256 {
            body["max_tokens"] = json!(256);
            payload = self.complete(&client, &body)?;
            content = payload
                .pointer("/choices/0/message/content")
                .and_then(Value::as_str)
                .filter(|value| !value.trim().is_empty());
        }
        let content = content.ok_or_else(|| {
            CoreError::Host("model response did not contain message content".into())
        })?;
        let plan_json = extract_json(content)?;
        serde_json::from_str(&plan_json).map_err(|error| {
            CoreError::Host(format!(
                "model returned invalid TaskPlanV1: {error}; response: {}",
                bounded_model_text(content)
            ))
        })
    }

    fn complete(
        &self,
        client: &reqwest::blocking::Client,
        body: &Value,
    ) -> Result<Value, CoreError> {
        let mut request = client.post(self.config.endpoint()).json(body);
        if let Some(environment_variable) = &self.config.api_key_env {
            let key = env::var(environment_variable).map_err(|_| {
                CoreError::Host(format!(
                    "model credential is missing; set {environment_variable}"
                ))
            })?;
            request = request.bearer_auth(key);
        }
        let response = request
            .send()
            .map_err(|error| CoreError::Host(format!("model request: {error}")))?;
        let status = response.status();
        let payload: Value = response
            .json()
            .map_err(|error| CoreError::Host(format!("model response JSON: {error}")))?;
        if !status.is_success() {
            return Err(CoreError::Host(format!(
                "model request failed with {status}: {}",
                payload
            )));
        }
        Ok(payload)
    }
}

fn planning_system_prompt() -> &'static str {
    r#"Output only JSON. Format: {"objective":"goal","actions":[action]}. Actions: report(message), inspect_workspace, read_file(path), write_file(path,content), execute_command(program,args). Use only listed capabilities. Commands are direct binaries, never shell strings. No markdown or extra keys. Reports under 300 characters. Example: {"objective":"inspect","actions":[{"kind":"inspect_workspace"}]}"#
}

fn bounded_model_text(content: &str) -> String {
    let text: String = content.chars().take(2_000).collect();
    format!("{text:?}")
}

fn extract_json(content: &str) -> Result<String, CoreError> {
    let trimmed = content.trim();
    let without_fence = trimmed
        .strip_prefix("```json")
        .or_else(|| trimmed.strip_prefix("```JSON"))
        .or_else(|| trimmed.strip_prefix("```"))
        .unwrap_or(trimmed)
        .strip_suffix("```")
        .unwrap_or(trimmed)
        .trim();
    let start = without_fence
        .find('{')
        .ok_or_else(|| CoreError::Host("model response did not contain a JSON object".into()))?;
    let end = without_fence.rfind('}').ok_or_else(|| {
        CoreError::Host("model response did not contain a complete JSON object".into())
    })?;
    Ok(without_fence[start..=end].to_owned())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::task::TaskContextV1;
    use knolo_agent_core::{AgentId, AgentProfileKindV1};
    use std::io::{Read, Write};
    use std::net::TcpListener;
    use std::thread;

    #[test]
    fn local_model_config_validates_without_credentials() {
        let config = ModelConfigV1 {
            version: 1,
            id: "local".into(),
            provider: "ollama".into(),
            model: "qwen2.5-coder:7b".into(),
            base_url: "http://127.0.0.1:11434/v1".into(),
            api_key_env: None,
            temperature: 0.0,
            max_tokens: 2048,
        };
        config.validate().unwrap();
        assert_eq!(
            config.endpoint(),
            "http://127.0.0.1:11434/v1/chat/completions"
        );
    }

    #[test]
    fn provider_registry_rejects_unknown_provider_and_keeps_metadata_only() {
        let config = ModelConfigV1 {
            version: 1,
            id: "local".into(),
            provider: "ollama".into(),
            model: "test".into(),
            base_url: ModelProviderV1::Ollama.default_base_url().into(),
            api_key_env: None,
            temperature: 0.0,
            max_tokens: 128,
        };
        let registry = ModelRegistryV1::new(vec![config]).unwrap();
        assert_eq!(registry.get("local").unwrap().model, "test");
        assert_eq!(registry.list().count(), 1);
        assert!(ModelProviderV1::parse("unknown").is_err());
    }

    #[test]
    fn fenced_model_json_is_accepted() {
        assert_eq!(
            extract_json("```json\n{\"a\": 1}\n```").unwrap(),
            "{\"a\": 1}"
        );
    }

    #[test]
    #[ignore = "requires loopback networking; run explicitly in network-enabled CI"]
    fn openai_compatible_local_server_produces_a_plan() {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let address = listener.local_addr().unwrap();
        let server = thread::spawn(move || {
            let (mut stream, _) = listener.accept().unwrap();
            let mut request = [0_u8; 4096];
            let _ = stream.read(&mut request).unwrap();
            let body = r#"{"choices":[{"message":{"content":"{\"objective\":\"test\",\"actions\":[{\"kind\":\"report\",\"message\":\"local model works\"}]}"}}]}"#;
            write!(
                stream,
                "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
                body.len(),
                body
            )
            .unwrap();
        });
        let config = ModelConfigV1 {
            version: 1,
            id: "test".into(),
            provider: "ollama".into(),
            model: "test-model".into(),
            base_url: format!("http://{address}"),
            api_key_env: None,
            temperature: 0.0,
            max_tokens: 128,
        };
        let planner = OpenAiCompatiblePlanner::new(config).unwrap();
        let profile = AgentProfileV1::builtin(
            AgentProfileKindV1::Coding,
            AgentId::new("test-agent").unwrap(),
        );
        let context = TaskContextV1 {
            task: "test".into(),
            turn: 1,
            observations: Vec::new(),
            memories: Vec::new(),
        };
        let plan = planner.plan(&profile, &context).unwrap();
        assert_eq!(plan.actions.len(), 1);
        server.join().unwrap();
    }
}
