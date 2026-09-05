//! Portable adapter boundary. Hosts export `command` through their preferred
//! WASM ABI; keeping this crate ABI-neutral also permits native conformance tests.
//!
//! `inspect` is self-contained. `run` / `resume` advance the portable control
//! plane (state, routing, suspension) and return `dispatch` whenever a node
//! result is required. Hosts answer with `continue`. Tools, retrieval, clocks,
//! and durable stores stay host-bound.

mod execute;
mod protocol;

use execute::handle;
use protocol::ProtocolRequest;

/// Handle one versioned command encoded as UTF-8 JSON.
pub fn command(input: &str) -> String {
    let request: ProtocolRequest = match serde_json::from_str(input) {
        Ok(request) => request,
        Err(error) => return encode(vec![execute_error("unsupported", error.to_string())]),
    };
    encode(handle(request))
}

fn encode(responses: Vec<protocol::ProtocolResponse>) -> String {
    serde_json::to_string(&responses).expect("protocol response is serializable")
}

fn execute_error(kind: &'static str, message: String) -> protocol::ProtocolResponse {
    protocol::ProtocolResponse::Error {
        failure: protocol::Failure { kind, message },
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::{json, Value};

    const GRAPH: &str =
        include_str!("../../../contracts/fixtures/conformance/portable-graph-v1.json");
    const SCHEMA: &str =
        r#"{"version":1,"id":"counter-state","paths":{"/count":"Number"},"required":["/count"]}"#;

    fn envelope(command: Value) -> String {
        format!(
            r#"{{"version":1,"command":{command},"graph":{GRAPH},"schema":{SCHEMA},"now_ms":0}}"#
        )
    }

    fn inspect_only() -> String {
        format!(r#"{{"version":1,"command":{{"type":"inspect"}},"graph":{GRAPH}}}"#)
    }

    fn first_dispatch(responses: &Value) -> (Value, Value) {
        let dispatch = responses
            .as_array()
            .unwrap()
            .iter()
            .find(|item| item["type"] == "dispatch")
            .unwrap();
        (dispatch["request"].clone(), dispatch["session"].clone())
    }

    fn report(responses: &Value) -> &Value {
        responses
            .as_array()
            .unwrap()
            .iter()
            .find(|item| item["type"] == "report")
            .unwrap()
    }

    fn drive_counter(initial: u64) -> Value {
        let mut raw = command(&envelope(json!({
            "type": "run",
            "execution_id": "portable-counter",
            "state": { "count": initial }
        })));
        loop {
            let responses: Value = serde_json::from_str(&raw).unwrap();
            if responses
                .as_array()
                .unwrap()
                .iter()
                .any(|item| item["type"] == "report")
            {
                return responses;
            }
            if responses
                .as_array()
                .unwrap()
                .iter()
                .any(|item| item["type"] == "error")
            {
                panic!("protocol error: {responses}");
            }
            let (request, session) = first_dispatch(&responses);
            let execution = match request["node_id"].as_str().unwrap() {
                "increment" => json!({
                    "outcome": { "type": "continue", "patch": { "count": request["state"]["count"].as_u64().unwrap() + 1 } },
                    "tokens": 1,
                    "cost_micros": 0
                }),
                "done" => json!({
                    "outcome": { "type": "terminate", "result": request["state"]["count"] },
                    "tokens": 0,
                    "cost_micros": 0
                }),
                other => panic!("unexpected node {other}"),
            };
            raw = command(&envelope(json!({
                "type": "continue",
                "session": session,
                "execution": execution
            })));
        }
    }

    #[test]
    fn shared_graph_is_accepted_by_wasm_protocol() {
        let result: Value = serde_json::from_str(&command(&inspect_only())).unwrap();
        assert_eq!(result[0]["type"], "inspection");
        assert_eq!(result[0]["inspection"]["engine"], "wasm");
        assert_eq!(
            result[0]["inspection"]["limitations"][0],
            "host node handlers use the versioned continue boundary"
        );
    }

    #[test]
    fn run_without_schema_fails_closed() {
        let request = format!(
            r#"{{"version":1,"command":{{"type":"run","execution_id":"x","state":{{"count":0}}}},"graph":{GRAPH}}}"#
        );
        let result: Value = serde_json::from_str(&command(&request)).unwrap();
        assert_eq!(result[0]["type"], "error");
        assert_eq!(result[0]["failure"]["type"], "definition");
    }

    #[test]
    fn portable_counter_run_emits_host_dispatch_then_terminates() {
        let responses = drive_counter(0);
        let report = report(&responses);
        assert_eq!(report["report"]["status"]["type"], "terminated");
        assert_eq!(report["report"]["status"]["result"], 1);
        assert_eq!(report["report"]["state"]["value"]["count"], 1);
        assert_eq!(report["report"]["steps"], 2);
        assert_eq!(report["report"]["tokens"], 1);
        let kinds: Vec<&str> = report["report"]["events"]
            .as_array()
            .unwrap()
            .iter()
            .map(|event| event["kind"]["type"].as_str().unwrap())
            .collect();
        assert_eq!(
            kinds,
            [
                "execution_started",
                "node_started",
                "state_patched",
                "checkpointed",
                "node_started",
                "terminated"
            ]
        );
        assert!(report["report"]["snapshots"].as_array().unwrap().len() >= 2);
        assert_eq!(
            report["report"]["events"][0]["kind"]["type"],
            "execution_started"
        );
    }

    #[test]
    fn resume_reenters_pending_node_with_host_input() {
        let graph: Value = serde_json::from_str(GRAPH).unwrap();
        let compiled_hash = {
            use knolo_agent_core::GraphDefinitionV1;
            let definition: GraphDefinitionV1 = serde_json::from_value(graph.clone()).unwrap();
            definition.compile().unwrap().hash().to_string()
        };
        let checkpoint = json!({
            "version": 1,
            "execution_id": "resume-counter",
            "graph_hash": compiled_hash,
            "pack_hash": "",
            "policy_hash": "",
            "node_implementation_hash": "",
            "contract_hash": "",
            "state": {
                "schema_id": "counter-state",
                "revision": 1,
                "value": { "count": 4 },
                "provenance": null
            },
            "pending_node": "done",
            "event_cursor": 4,
            "steps": 1,
            "tokens": 1,
            "cost_micros": 0
        });
        let raw = command(&envelope(json!({
            "type": "resume",
            "checkpoint": checkpoint,
            "input": { "approved": true }
        })));
        let responses: Value = serde_json::from_str(&raw).unwrap();
        let (request, session) = first_dispatch(&responses);
        assert_eq!(request["node_id"], "done");
        assert_eq!(request["state"]["count"], 4);
        let finished: Value = serde_json::from_str(&command(&envelope(json!({
            "type": "continue",
            "session": session,
            "execution": { "outcome": { "type": "terminate", "result": 4 } }
        }))))
        .unwrap();
        assert_eq!(report(&finished)["report"]["status"]["result"], 4);
    }

    #[test]
    fn step_budget_is_enforced_before_dispatch() {
        let mut graph: Value = serde_json::from_str(GRAPH).unwrap();
        graph["limits"]["max_steps"] = json!(1);
        let request = json!({
            "version": 1,
            "command": { "type": "run", "execution_id": "budget", "state": { "count": 0 } },
            "graph": graph,
            "schema": serde_json::from_str::<Value>(SCHEMA).unwrap(),
            "now_ms": 0
        });
        let first: Value = serde_json::from_str(&command(&request.to_string())).unwrap();
        let (request_body, session) = first_dispatch(&first);
        assert_eq!(request_body["node_id"], "increment");
        let second: Value = serde_json::from_str(&command(&json!({
            "version": 1,
            "command": {
                "type": "continue",
                "session": session,
                "execution": { "outcome": { "type": "continue", "patch": { "count": 1 } }, "tokens": 1 }
            },
            "graph": graph,
            "schema": serde_json::from_str::<Value>(SCHEMA).unwrap(),
            "now_ms": 0
        }).to_string())).unwrap();
        let kinds: Vec<&str> = report(&second)["report"]["events"]
            .as_array()
            .unwrap()
            .iter()
            .map(|event| event["kind"]["type"].as_str().unwrap())
            .collect();
        assert!(kinds.contains(&"failed"));
        assert_eq!(
            report(&second)["report"]["status"]["error"],
            "step budget exceeded"
        );
    }
}
