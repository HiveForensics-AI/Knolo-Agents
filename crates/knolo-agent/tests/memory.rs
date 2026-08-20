use knolo_agent::memory::LocalMemoryStore;
use knolo_agent::{AgentId, AgentProfileKindV1, AgentProfileV1};
use knolo_agent_core::{MemoryScopeV1, NamespaceId};
use std::time::{SystemTime, UNIX_EPOCH};

fn test_root() -> std::path::PathBuf {
    std::env::temp_dir().join(format!(
        "knolo-memory-test-{}",
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos()
    ))
}

#[test]
fn memory_recall_is_scoped_and_writes_fail_without_grant() {
    let mut profile = AgentProfileV1::builtin(
        AgentProfileKindV1::Custom,
        AgentId::new("memory-test").unwrap(),
    );
    let namespace = NamespaceId::new("agent/test").unwrap();
    profile
        .memory_scopes
        .push(MemoryScopeV1::read_write(namespace.clone(), 4, 4096));
    profile.validate().unwrap();

    let store = LocalMemoryStore::new(test_root());
    store
        .remember(
            &profile,
            "agent/test",
            "The project uses a local-first model.",
            "test",
        )
        .unwrap();
    assert_eq!(store.recall(&profile, "local model").unwrap().len(), 1);

    let read_only = AgentProfileV1::builtin(
        AgentProfileKindV1::Custom,
        AgentId::new("read-only").unwrap(),
    );
    assert!(store
        .remember(&read_only, "agent/test", "should fail", "test")
        .is_err());
}
