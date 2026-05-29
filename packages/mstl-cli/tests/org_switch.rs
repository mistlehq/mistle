use std::fs;
use std::path::Path;
use std::process::Command;

use mstl_core::auth::{API_KEY_ENV_VAR, CONTROL_PLANE_API_PUBLIC_URL_ENV_VAR};

mod common;

#[test]
fn org_switch_requires_authentication() {
    let output = Command::new(env!("CARGO_BIN_EXE_mistle"))
        .args(["org", "switch", "first"])
        .env_remove(API_KEY_ENV_VAR)
        .env_remove(CONTROL_PLANE_API_PUBLIC_URL_ENV_VAR)
        .env(
            "XDG_CONFIG_HOME",
            common::isolated_config_home("org-switch"),
        )
        .output()
        .expect("mistle binary should run");

    assert!(!output.status.success());
    assert_eq!(String::from_utf8_lossy(&output.stdout), "");
    assert_eq!(
        String::from_utf8_lossy(&output.stderr),
        "organization switching requires `mistle login`; API key authentication cannot be switched\n"
    );
}

#[test]
fn org_switch_rejects_api_key_auth_file() {
    let config_home = common::isolated_config_home("org-switch-api-key");
    write_api_key_auth_file(&config_home);

    let output = Command::new(env!("CARGO_BIN_EXE_mistle"))
        .args(["org", "switch", "first"])
        .env_remove(API_KEY_ENV_VAR)
        .env_remove(CONTROL_PLANE_API_PUBLIC_URL_ENV_VAR)
        .env("XDG_CONFIG_HOME", &config_home)
        .output()
        .expect("mistle binary should run");

    assert!(!output.status.success());
    assert_eq!(String::from_utf8_lossy(&output.stdout), "");
    assert_eq!(
        String::from_utf8_lossy(&output.stderr),
        "organization switching requires `mistle login`; API key authentication cannot be switched\n"
    );
}

#[test]
fn org_switch_rejects_api_key_env_before_oauth_auth_file() {
    let config_home = common::isolated_config_home("org-switch-env-api-key");
    write_oauth_auth_file(&config_home);

    let output = Command::new(env!("CARGO_BIN_EXE_mistle"))
        .args(["org", "switch", "first"])
        .env(API_KEY_ENV_VAR, "mstl_apk_test")
        .env_remove(CONTROL_PLANE_API_PUBLIC_URL_ENV_VAR)
        .env("XDG_CONFIG_HOME", &config_home)
        .output()
        .expect("mistle binary should run");

    assert!(!output.status.success());
    assert_eq!(String::from_utf8_lossy(&output.stdout), "");
    assert_eq!(
        String::from_utf8_lossy(&output.stderr),
        "organization switching requires `mistle login`; API key authentication cannot be switched\n"
    );
}

fn write_api_key_auth_file(config_home: &str) {
    let auth_directory = Path::new(config_home).join("mistle");
    fs::create_dir_all(&auth_directory).expect("create auth directory");
    fs::write(
        auth_directory.join("auth.json"),
        r#"{
  "authMode": "api_key",
  "apiKey": "mstl_apk_test"
}
"#,
    )
    .expect("write auth file");
}

fn write_oauth_auth_file(config_home: &str) {
    let auth_directory = Path::new(config_home).join("mistle");
    fs::create_dir_all(&auth_directory).expect("create auth directory");
    fs::write(
        auth_directory.join("auth.json"),
        r#"{
  "authMode": "oauth",
  "oauth": {
    "accessToken": "mstl_oat_access",
    "refreshToken": "mstl_ort_refresh",
    "expiresAt": 9999999999,
    "scope": "organization:read"
  }
}
"#,
    )
    .expect("write auth file");
}
