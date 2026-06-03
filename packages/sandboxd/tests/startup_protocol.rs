use sandboxd::protocol::activation::ActivationInput;
use sandboxd::protocol::startup::{
    ActivationErrorResponse, ActivationOkResponse, ActivationResponse,
};

#[test]
fn decodes_activation_input_fixture() {
    let fixture =
        include_str!("../../sandbox-runtime-contract/tests/fixtures/activation-input.valid.json");

    let activation_input: ActivationInput =
        serde_json::from_str(fixture).expect("activation-input fixture should decode");

    assert_eq!(activation_input.bootstrap_token, "bootstrap-token-value");
    assert_eq!(
        activation_input.tunnel_exchange_token,
        "tunnel-exchange-token-value"
    );
    assert_eq!(
        activation_input.tunnel_gateway_ws_url,
        "ws://127.0.0.1:5003/tunnel/sandbox"
    );
    assert_eq!(activation_input.runtime_plan["sandboxProfileId"], "sbp_123");
}

#[test]
fn decodes_activation_ok_response() {
    let response: ActivationResponse =
        serde_json::from_str(r#"{"ok":true}"#).expect("activation ok response should decode");

    assert_eq!(
        response,
        ActivationResponse::Ok(ActivationOkResponse { ok: true })
    );
}

#[test]
fn decodes_activation_error_response() {
    let response: ActivationResponse =
        serde_json::from_str(r#"{"ok":false,"error":"sandbox activation failed"}"#)
            .expect("activation error response should decode");

    assert_eq!(
        response,
        ActivationResponse::Error(ActivationErrorResponse {
            ok: false,
            error: "sandbox activation failed".to_string(),
        })
    );
}
