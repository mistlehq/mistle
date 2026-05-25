use std::process::Command;

use mstl_core::auth::{API_KEY_ENV_VAR, CONTROL_PLANE_API_PUBLIC_URL_ENV_VAR};

mod common;

#[test]
fn codex_requires_api_key_env_var() {
    let output = Command::new(env!("CARGO_BIN_EXE_mistle"))
        .args(["codex", "--sandbox", "sbi_test", "--", "--model", "gpt-5.2"])
        .env_remove(API_KEY_ENV_VAR)
        .env_remove(CONTROL_PLANE_API_PUBLIC_URL_ENV_VAR)
        .env(
            "XDG_CONFIG_HOME",
            common::isolated_config_home("codex-missing-auth"),
        )
        .output()
        .expect("mistle binary should run");

    assert!(!output.status.success());
    assert_eq!(String::from_utf8_lossy(&output.stdout), "");
    assert_eq!(
        String::from_utf8_lossy(&output.stderr),
        "missing Mistle authentication; run `mistle login` or set MISTLE_API_KEY\n"
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
        .env(
            "XDG_CONFIG_HOME",
            common::isolated_config_home("codex-remote"),
        )
        .output()
        .expect("mistle binary should run");

    assert!(!output.status.success());
    assert_eq!(String::from_utf8_lossy(&output.stdout), "");
    assert_eq!(
        String::from_utf8_lossy(&output.stderr),
        "failed to validate codex arguments: codex arguments must not include --remote; mistle manages the remote endpoint\n"
    );
}
