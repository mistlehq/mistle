use super::*;

#[test]
fn set_agent_endpoint_request_updates_the_existing_tunnel_session() {
    let (tunnel_writer_sender, _tunnel_writer_receiver) = tokio::sync::mpsc::unbounded_channel();
    let (response_sender, response_receiver) = mpsc::channel();
    let runtime = test_tunnel_session_runtime();
    let mut session_state = empty_tunnel_session_state();

    handle_tunnel_session_request(
        TunnelSessionRequest::SetAgentEndpoint {
            agent_endpoint_url: Some("ws://127.0.0.1:12345/agent".to_string()),
            response_sender,
        },
        &tunnel_writer_sender,
        &runtime,
        &mut session_state,
    )
    .expect("agent endpoint update should be handled");

    response_receiver
        .recv()
        .expect("endpoint update should acknowledge")
        .expect("endpoint update should succeed");
    assert_eq!(
        session_state.agent_endpoint_url.as_deref(),
        Some("ws://127.0.0.1:12345/agent")
    );
    let connection_state = snapshot_runtime_connection_state(&runtime);
    assert_eq!(
        connection_state.agent_endpoint_url.as_deref(),
        Some("ws://127.0.0.1:12345/agent")
    );
}

#[test]
fn set_runtime_environment_request_updates_the_existing_tunnel_session() {
    let (tunnel_writer_sender, _tunnel_writer_receiver) = tokio::sync::mpsc::unbounded_channel();
    let (response_sender, response_receiver) = mpsc::channel();
    let runtime = test_tunnel_session_runtime();
    let mut session_state = empty_tunnel_session_state();

    handle_tunnel_session_request(
        TunnelSessionRequest::SetRuntimeEnvironment {
            runtime_env: BTreeMap::from([("MISTLE_RUNTIME_ENV".to_string(), "ready".to_string())]),
            response_sender,
        },
        &tunnel_writer_sender,
        &runtime,
        &mut session_state,
    )
    .expect("runtime environment update should be handled");

    response_receiver
        .recv()
        .expect("runtime environment update should acknowledge")
        .expect("runtime environment update should succeed");
    assert_eq!(
        session_state.runtime_env.get("MISTLE_RUNTIME_ENV"),
        Some(&"ready".to_string())
    );
    let connection_state = snapshot_runtime_connection_state(&runtime);
    assert_eq!(
        connection_state.runtime_env.get("MISTLE_RUNTIME_ENV"),
        Some(&"ready".to_string())
    );
}
