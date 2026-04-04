use sandboxd::protocol::keepalive::{KeepaliveMessageType, KeepaliveState};

#[test]
fn decodes_keepalive_state_fixture() {
    let fixture =
        include_str!("../../sandbox-runtime-contract/tests/fixtures/keepalive-state.valid.json");

    let state: KeepaliveState =
        serde_json::from_str(fixture).expect("keepalive fixture should decode");

    assert_eq!(state.message_type, KeepaliveMessageType::State);
    assert!(state.active);
    assert_eq!(state.ttl_ms, 30_000);
}
