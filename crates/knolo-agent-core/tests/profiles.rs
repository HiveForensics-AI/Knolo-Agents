use knolo_agent_core::{AgentId, AgentProfileKindV1, AgentProfileV1, CoreError};

#[test]
fn builtin_profiles_are_valid_and_have_explicit_limits() {
    let profile =
        AgentProfileV1::builtin(AgentProfileKindV1::Coding, AgentId::new("coding").unwrap());
    profile.validate().unwrap();
    assert!(profile.autonomy.max_turns > 0);
    assert!(profile
        .capabilities
        .iter()
        .any(|cap| cap == "workspace.write"));
}

#[test]
fn profiles_reject_unbounded_autonomy() {
    let mut profile =
        AgentProfileV1::builtin(AgentProfileKindV1::Custom, AgentId::new("custom").unwrap());
    profile.autonomy.max_actions = 0;
    assert!(matches!(
        profile.validate(),
        Err(CoreError::InvalidProfile(_))
    ));
}
