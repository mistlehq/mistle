use std::process::Command;

const API_KEY_ENV_VAR: &str = "MISTLE_API_KEY";

#[test]
fn auth_status_reports_authenticated_when_api_key_env_var_is_set() {
    let output = Command::new(env!("CARGO_BIN_EXE_mstl"))
        .args(["auth", "status"])
        .env(API_KEY_ENV_VAR, "mstl_test_key")
        .output()
        .expect("mstl binary should run");

    assert!(
        output.status.success(),
        "stderr: {}",
        String::from_utf8_lossy(&output.stderr)
    );
    assert_eq!(String::from_utf8_lossy(&output.stdout), "authenticated\n");
    assert_eq!(String::from_utf8_lossy(&output.stderr), "");
}

#[test]
fn auth_status_reports_not_authenticated_when_api_key_env_var_is_missing() {
    let output = Command::new(env!("CARGO_BIN_EXE_mstl"))
        .args(["auth", "status"])
        .env_remove(API_KEY_ENV_VAR)
        .output()
        .expect("mstl binary should run");

    assert!(!output.status.success());
    assert_eq!(
        String::from_utf8_lossy(&output.stdout),
        "not authenticated\n"
    );
    assert_eq!(String::from_utf8_lossy(&output.stderr), "");
}

#[test]
fn auth_status_reports_not_authenticated_when_api_key_env_var_is_blank() {
    let output = Command::new(env!("CARGO_BIN_EXE_mstl"))
        .args(["auth", "status"])
        .env(API_KEY_ENV_VAR, "")
        .output()
        .expect("mstl binary should run");

    assert!(!output.status.success());
    assert_eq!(
        String::from_utf8_lossy(&output.stdout),
        "not authenticated\n"
    );
    assert_eq!(String::from_utf8_lossy(&output.stderr), "");
}
