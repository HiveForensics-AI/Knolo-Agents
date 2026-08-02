use knolo_agent::{
    pack::{load_agent, load_manifest},
    CoreError,
};

const PACK: &str = include_str!("../../../examples/packs/agent-e2e.knolo.json");

#[test]
fn loads_real_manifest_and_agent_constraints() {
    let loaded = load_agent(PACK, "research").unwrap();
    assert_eq!(loaded.pack.id.as_str(), "examples.agent-e2e");
    assert_eq!(loaded.graph.as_str(), "examples.research.graph");
    assert_eq!(loaded.definition, "examples/agents/research.json");
    assert!(loaded.policy.allows_tool(&"search".parse().unwrap()));
    assert!(loaded
        .policy
        .allows_namespace(&"knowledge/private".parse().unwrap()));
}

#[test]
fn rejects_missing_capability_and_namespace_grants() {
    let missing_capability =
        PACK.replace("\"cortex\": \"host:cortex\"", "\"other\": \"host:other\"");
    assert!(matches!(
        load_agent(&missing_capability, "research"),
        Err(CoreError::PackLoad(message)) if message.contains("ungranted capability")
    ));

    let missing_namespace = PACK
        .replace("knowledge/private", "knowledge/public")
        .replacen("knowledge/public", "knowledge/private", 1);
    assert!(matches!(
        load_agent(&missing_namespace, "research"),
        Err(CoreError::PackLoad(message)) if message.contains("ungranted namespace")
    ));
}

#[test]
fn malformed_manifest_fails_hard() {
    assert!(matches!(
        load_manifest("{\"version\":1}"),
        Err(CoreError::PackLoad(_))
    ));
}
