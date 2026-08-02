//! Portable adapter boundary. Hosts export `command` through their preferred
//! WASM ABI; keeping this crate ABI-neutral also permits native conformance tests.
use knolo_agent_core::GraphDefinitionV1;
use serde::{Deserialize, Serialize};
use serde_json::Value;

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct ProtocolRequest {
    version: u16,
    command: Value,
    graph: GraphDefinitionV1,
}

#[derive(Debug, Serialize)]
#[serde(tag = "type", rename_all = "snake_case")]
enum ProtocolResponse {
    Inspection { inspection: Inspection },
    Error { failure: Failure },
}

#[derive(Debug, Serialize)]
struct Inspection {
    engine: &'static str,
    graph: GraphDefinitionV1,
    capabilities: [&'static str; 3],
    limitations: [&'static str; 1],
}

#[derive(Debug, Serialize)]
struct Failure {
    #[serde(rename = "type")]
    kind: &'static str,
    message: String,
}

/// Handle one versioned command encoded as UTF-8 JSON.
pub fn command(input: &str) -> String {
    let request: ProtocolRequest = match serde_json::from_str(input) {
        Ok(request) => request,
        Err(error) => return error_response(error.to_string()),
    };
    if request.version != 1 {
        return error_response("unsupported protocol version".into());
    }
    if let Err(error) = request.graph.validate() {
        return error_response(error.to_string());
    }
    if request.command.get("type").and_then(Value::as_str) != Some("inspect") {
        return error_response(
            "this ABI-neutral adapter supports inspect; execution requires host node dispatch"
                .into(),
        );
    }
    serde_json::to_string(&[ProtocolResponse::Inspection {
        inspection: Inspection {
            engine: "wasm",
            graph: request.graph,
            capabilities: ["state", "routing", "suspension"],
            limitations: ["execution requires host node dispatch"],
        },
    }])
    .expect("protocol response is serializable")
}

fn error_response(message: String) -> String {
    serde_json::to_string(&[ProtocolResponse::Error {
        failure: Failure {
            kind: "unsupported",
            message,
        },
    }])
    .expect("protocol error is serializable")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn shared_graph_is_accepted_by_wasm_protocol() {
        let graph = include_str!("../../../contracts/fixtures/conformance/portable-graph-v1.json");
        let request = format!(r#"{{"version":1,"command":{{"type":"inspect"}},"graph":{graph}}}"#);
        let result: Value = serde_json::from_str(&command(&request)).unwrap();
        assert_eq!(result[0]["type"], "inspection");
        assert_eq!(result[0]["inspection"]["engine"], "wasm");
    }
}
