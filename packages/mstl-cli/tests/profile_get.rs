use std::process::Command;

const API_KEY_ENV_VAR: &str = "MISTLE_API_KEY";
const CONTROL_PLANE_API_PUBLIC_URL_ENV_VAR: &str = "MISTLE_SERVICES_CONTROL_PLANE_API_PUBLIC_URL";

#[test]
fn profile_get_requires_api_key_env_var() {
    let output = Command::new(env!("CARGO_BIN_EXE_mistle"))
        .args(["profile", "get", "sbp_test"])
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
fn profile_get_requires_control_plane_public_url_env_var() {
    let output = Command::new(env!("CARGO_BIN_EXE_mistle"))
        .args(["profile", "get", "sbp_test"])
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
