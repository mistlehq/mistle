use sandboxd::protocol::startup::{
    StartupApplyRequest, StartupApplyResponse, StartupInput, StartupMode,
};

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
fn decodes_startup_apply_request_fixture() {
    let fixture = include_str!(
        "../../sandbox-runtime-contract/tests/fixtures/startup-apply-request.valid.json"
    );

    let request: StartupApplyRequest =
        serde_json::from_str(fixture).expect("startup-apply-request fixture should decode");

    assert_eq!(request.token, "startup-apply-token");
    assert_eq!(request.startup_input.startup_mode, StartupMode::New);
    assert_eq!(
        request.startup_input.runtime_plan["image"]["imageRef"],
        "mistle/sandbox-base:dev"
    );
}

#[test]
fn decodes_startup_apply_ok_response_fixture() {
    let fixture = include_str!(
        "../../sandbox-runtime-contract/tests/fixtures/startup-apply-response.ok.valid.json"
    );

    let response: StartupApplyResponse =
        serde_json::from_str(fixture).expect("startup apply ok fixture should decode");

    assert_eq!(
        response,
        StartupApplyResponse::Ok(sandboxd::protocol::startup::StartupApplyOkResponse { ok: true })
    );
}

#[test]
fn decodes_startup_apply_error_response_fixture() {
    let fixture = include_str!(
        "../../sandbox-runtime-contract/tests/fixtures/startup-apply-response.error.valid.json"
    );

    let response: StartupApplyResponse =
        serde_json::from_str(fixture).expect("startup apply error fixture should decode");

    assert_eq!(
        response,
        StartupApplyResponse::Error(sandboxd::protocol::startup::StartupApplyErrorResponse {
            ok: false,
            error: "startup apply failed".to_string(),
        })
    );
}
