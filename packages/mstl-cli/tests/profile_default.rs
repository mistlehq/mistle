use std::fs;
use std::path::Path;
use std::process::Command;

use mstl_core::auth::{API_KEY_ENV_VAR, CONTROL_PLANE_API_PUBLIC_URL_ENV_VAR};

mod common;

#[test]
fn profile_default_set_get_and_unset_update_cli_config() {
    let config_home = common::isolated_config_home("profile-default");

    let set_output = Command::new(env!("CARGO_BIN_EXE_mistle"))
        .args(["profile", "default", "set", "sbp_python"])
        .env_remove(API_KEY_ENV_VAR)
        .env_remove(CONTROL_PLANE_API_PUBLIC_URL_ENV_VAR)
        .env("XDG_CONFIG_HOME", &config_home)
        .output()
        .expect("mistle binary should run");

    assert!(set_output.status.success());
    assert_eq!(String::from_utf8_lossy(&set_output.stderr), "");
    assert_eq!(
        String::from_utf8_lossy(&set_output.stdout),
        "Default profile set to sbp_python\n"
    );
    assert_eq!(
        fs::read_to_string(config_path(&config_home)).expect("config should be written"),
        "{\n  \"defaultProfileId\": \"sbp_python\"\n}\n"
    );

    let get_output = Command::new(env!("CARGO_BIN_EXE_mistle"))
        .args(["profile", "default", "get"])
        .env_remove(API_KEY_ENV_VAR)
        .env_remove(CONTROL_PLANE_API_PUBLIC_URL_ENV_VAR)
        .env("XDG_CONFIG_HOME", &config_home)
        .output()
        .expect("mistle binary should run");

    assert!(get_output.status.success());
    assert_eq!(String::from_utf8_lossy(&get_output.stderr), "");
    assert_eq!(
        String::from_utf8_lossy(&get_output.stdout),
        "Default profile: sbp_python\n"
    );

    let unset_output = Command::new(env!("CARGO_BIN_EXE_mistle"))
        .args(["profile", "default", "unset"])
        .env_remove(API_KEY_ENV_VAR)
        .env_remove(CONTROL_PLANE_API_PUBLIC_URL_ENV_VAR)
        .env("XDG_CONFIG_HOME", &config_home)
        .output()
        .expect("mistle binary should run");

    assert!(unset_output.status.success());
    assert_eq!(String::from_utf8_lossy(&unset_output.stderr), "");
    assert_eq!(
        String::from_utf8_lossy(&unset_output.stdout),
        "Default profile unset\n"
    );

    let get_after_unset_output = Command::new(env!("CARGO_BIN_EXE_mistle"))
        .args(["profile", "default", "get"])
        .env_remove(API_KEY_ENV_VAR)
        .env_remove(CONTROL_PLANE_API_PUBLIC_URL_ENV_VAR)
        .env("XDG_CONFIG_HOME", &config_home)
        .output()
        .expect("mistle binary should run");

    assert!(get_after_unset_output.status.success());
    assert_eq!(String::from_utf8_lossy(&get_after_unset_output.stderr), "");
    assert_eq!(
        String::from_utf8_lossy(&get_after_unset_output.stdout),
        "No default profile configured.\n"
    );
}

fn config_path(config_home: &str) -> std::path::PathBuf {
    Path::new(config_home).join("mistle").join("config.json")
}
