use knolo_agent_core::GraphDefinitionV1;

#[test]
fn typescript_fixture_compiles_in_rust() {
    let fixture = include_str!("../../../contracts/fixtures/conformance/portable-graph-v1.json");
    let graph: GraphDefinitionV1 = serde_json::from_str(fixture).unwrap();
    let compiled = graph.compile().unwrap();
    assert_eq!(compiled.definition().id.as_str(), "portable-counter");
    assert_eq!(
        compiled
            .route(&"increment".parse().unwrap(), "continue")
            .unwrap()
            .as_str(),
        "done"
    );
}
