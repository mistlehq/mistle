use sandboxd::protocol::runtime_state::RuntimeStateSnapshot;

#[test]
fn decodes_runtime_state_fixture() {
    let fixture =
        include_str!("../../sandbox-runtime-contract/tests/fixtures/runtime-state.valid.json");

    let snapshot: RuntimeStateSnapshot =
        serde_json::from_str(fixture).expect("runtime-state fixture should decode");

    assert_eq!(snapshot.owner_lease_id.as_deref(), Some("owner_123"));
    assert_eq!(snapshot.presence.active_count, 1);
    assert!(snapshot.keepalive.active);

    let attachment = snapshot
        .attachment
        .expect("runtime-state fixture should include attachment");

    assert_eq!(attachment.sandbox_instance_id, "sbi_123");
    assert_eq!(attachment.owner_lease_id, "owner_123");
    assert_eq!(attachment.node_id, "node_123");
    assert_eq!(attachment.session_id, "session_123");
    assert_eq!(attachment.attached_at_ms, 1_730_910_000);
}
