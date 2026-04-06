use sandboxd::protocol::startup::{StartupInitResponse, StartupInput, StartupMode};

#[test]
fn decodes_startup_input_fixture() {
    let fixture =
        include_str!("../../sandbox-runtime-contract/tests/fixtures/startup-input.valid.json");

    let startup_input: StartupInput =
        serde_json::from_str(fixture).expect("startup-input fixture should decode");

    assert_eq!(startup_input.startup_mode, StartupMode::New);
    assert_eq!(startup_input.bootstrap_token, "bootstrap-token-value");
    assert_eq!(
        startup_input.tunnel_exchange_token,
        "tunnel-exchange-token-value"
    );
    assert_eq!(
        startup_input.tunnel_gateway_ws_url,
        "ws://127.0.0.1:5003/tunnel/sandbox"
    );
    assert!(startup_input.egress_grant_by_rule_id.is_empty());
    assert_eq!(startup_input.runtime_plan["sandboxProfileId"], "sbp_123");
}

#[test]
fn decodes_startup_init_ok_response_fixture() {
    let fixture = include_str!(
        "../../sandbox-runtime-contract/tests/fixtures/startup-init-response.ok.valid.json"
    );

    let response: StartupInitResponse =
        serde_json::from_str(fixture).expect("startup init ok fixture should decode");

    assert_eq!(
        response,
        StartupInitResponse::Ok(sandboxd::protocol::startup::StartupInitOkResponse { ok: true })
    );
}

#[test]
fn decodes_startup_init_error_response_fixture() {
    let fixture = include_str!(
        "../../sandbox-runtime-contract/tests/fixtures/startup-init-response.error.valid.json"
    );

    let response: StartupInitResponse =
        serde_json::from_str(fixture).expect("startup init error fixture should decode");

    assert_eq!(
        response,
        StartupInitResponse::Error(sandboxd::protocol::startup::StartupInitErrorResponse {
            ok: false,
            error: "sandbox init failed".to_string(),
        })
    );
}
