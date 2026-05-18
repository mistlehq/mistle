use std::process::Command;

use mstl_core::auth::{API_KEY_ENV_VAR, CONTROL_PLANE_API_PUBLIC_URL_ENV_VAR};

#[test]
fn codex_requires_api_key_env_var() {
    let output = Command::new(env!("CARGO_BIN_EXE_mistle"))
        .args(["codex", "--sandbox", "sbi_test", "--", "--model", "gpt-5.2"])
        .env_remove(API_KEY_ENV_VAR)
        .env_remove(CONTROL_PLANE_API_PUBLIC_URL_ENV_VAR)
        .output()
        .expect("mistle binary should run");

    assert!(!output.status.success());
    assert_eq!(String::from_utf8_lossy(&output.stdout), "");
    assert_eq!(
        String::from_utf8_lossy(&output.stderr),
        "Missing required environment variable: MISTLE_API_KEY\n"
    );
}

#[test]
fn codex_rejects_user_supplied_remote_before_reading_auth_env() {
    let output = Command::new(env!("CARGO_BIN_EXE_mistle"))
        .args([
            "codex",
            "--sandbox",
            "sbi_test",
            "--",
            "--remote",
            "ws://127.0.0.1:1",
        ])
        .env_remove(API_KEY_ENV_VAR)
        .env_remove(CONTROL_PLANE_API_PUBLIC_URL_ENV_VAR)
        .output()
        .expect("mistle binary should run");

    assert!(!output.status.success());
    assert_eq!(String::from_utf8_lossy(&output.stdout), "");
    assert_eq!(
        String::from_utf8_lossy(&output.stderr),
        "failed to validate codex arguments: codex arguments must not include --remote; mistle manages the remote endpoint\n"
    );
}

#[test]
fn codex_requires_control_plane_public_url_env_var() {
    let output = Command::new(env!("CARGO_BIN_EXE_mistle"))
        .args(["codex", "--sandbox", "sbi_test"])
        .env(API_KEY_ENV_VAR, "mstl_test_key")
        .env_remove(CONTROL_PLANE_API_PUBLIC_URL_ENV_VAR)
        .output()
        .expect("mistle binary should run");

    assert!(!output.status.success());
    assert_eq!(String::from_utf8_lossy(&output.stdout), "");
    assert_eq!(
        String::from_utf8_lossy(&output.stderr),
        "Missing required environment variable: MISTLE_SERVICES_CONTROL_PLANE_API_PUBLIC_URL\n"
    );
}
