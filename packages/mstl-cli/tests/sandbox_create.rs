use std::process::Command;

use mstl_core::auth::{API_KEY_ENV_VAR, CONTROL_PLANE_API_PUBLIC_URL_ENV_VAR};

mod common;

#[test]
fn sandbox_create_requires_api_key_env_var() {
    let output = Command::new(env!("CARGO_BIN_EXE_mistle"))
        .args(["sandbox", "create", "--profile", "sbp_test"])
        .env_remove(API_KEY_ENV_VAR)
        .env_remove(CONTROL_PLANE_API_PUBLIC_URL_ENV_VAR)
        .env(
            "XDG_CONFIG_HOME",
            common::isolated_config_home("sandbox-create"),
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
