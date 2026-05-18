use std::process::Command;

use mstl_core::auth::{API_KEY_ENV_VAR, CONTROL_PLANE_API_PUBLIC_URL_ENV_VAR};

#[test]
fn whoami_requires_api_key_env_var() {
    let output = Command::new(env!("CARGO_BIN_EXE_mistle"))
        .arg("whoami")
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
fn whoami_rejects_blank_api_key_env_var() {
    let output = Command::new(env!("CARGO_BIN_EXE_mistle"))
        .arg("whoami")
        .env(API_KEY_ENV_VAR, " ")
        .env(
            CONTROL_PLANE_API_PUBLIC_URL_ENV_VAR,
            "https://api.example.test",
        )
        .output()
        .expect("mistle binary should run");

    assert!(!output.status.success());
    assert_eq!(String::from_utf8_lossy(&output.stdout), "");
    assert_eq!(
        String::from_utf8_lossy(&output.stderr),
        "MISTLE_API_KEY cannot be blank\n"
    );
}

#[test]
fn whoami_requires_control_plane_public_url_env_var() {
    let output = Command::new(env!("CARGO_BIN_EXE_mistle"))
        .arg("whoami")
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

#[test]
fn whoami_rejects_blank_control_plane_public_url_env_var() {
    let output = Command::new(env!("CARGO_BIN_EXE_mistle"))
        .arg("whoami")
        .env(API_KEY_ENV_VAR, "mstl_test_key")
        .env(CONTROL_PLANE_API_PUBLIC_URL_ENV_VAR, " ")
        .output()
        .expect("mistle binary should run");

    assert!(!output.status.success());
    assert_eq!(String::from_utf8_lossy(&output.stdout), "");
    assert_eq!(
        String::from_utf8_lossy(&output.stderr),
        "MISTLE_SERVICES_CONTROL_PLANE_API_PUBLIC_URL cannot be blank\n"
    );
}
