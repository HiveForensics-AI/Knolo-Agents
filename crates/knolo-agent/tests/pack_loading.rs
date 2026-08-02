use knolo_agent::{
    pack::{load_agent, load_agent_native, load_manifest, PackAgentReferenceV1},
    CoreError,
};

const PACK: &str = include_str!("../../../examples/packs/agent-e2e.knolo.json");
const NATIVE_PACK: &[u8] = include_bytes!("../fixtures/agent-e2e.knolo");

fn native_agent() -> PackAgentReferenceV1 {
    PackAgentReferenceV1 {
        graph: "examples.research.graph".parse().unwrap(),
        definition: "examples/agents/research.json".into(),
        capabilities: ["cortex".parse().unwrap()].into_iter().collect(),
        namespaces: ["knowledge/private".parse().unwrap()].into_iter().collect(),
    }
}

#[test]
fn loads_native_pack_bytes_and_agent_constraints() {
    let loaded = load_agent_native(NATIVE_PACK, "research", native_agent()).unwrap();
    assert_eq!(loaded.pack.id.as_str(), "examples.agent-e2e");
    assert!(loaded.policy.allows_tool(&"search".parse().unwrap()));
    assert!(loaded
        .policy
        .allows_namespace(&"knowledge/private".parse().unwrap()));
    assert_eq!(
        loaded.policy.binding(&"cortex".parse().unwrap()),
        Some("cortex")
    );
}

#[test]
fn native_pack_denies_unlisted_capability_and_namespace() {
    let missing_capability = String::from_utf8(NATIVE_PACK.to_vec())
        .unwrap()
        .replace("capabilities: [cortex]", "capabilities: [other]");
    assert!(matches!(
        load_agent_native(missing_capability.as_bytes(), "research", native_agent()),
        Err(CoreError::PackLoad(message)) if message.contains("ungranted capability")
    ));

    let missing_namespace = String::from_utf8(NATIVE_PACK.to_vec()).unwrap().replace(
        "namespaces: [knowledge/private]",
        "namespaces: [knowledge/public]",
    );
    assert!(matches!(
        load_agent_native(missing_namespace.as_bytes(), "research", native_agent()),
        Err(CoreError::PackLoad(message)) if message.contains("ungranted namespace")
    ));
}

#[test]
fn malformed_native_pack_fails_hard() {
    assert!(matches!(
        load_agent_native(
            b"version: 1\nid: examples.bad\n",
            "research",
            native_agent()
        ),
        Err(CoreError::PackLoad(_))
    ));
    assert!(matches!(
        load_agent_native(&[0xff, 0x00], "research", native_agent()),
        Err(CoreError::PackLoad(message)) if message.contains("not UTF-8")
    ));
}

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
