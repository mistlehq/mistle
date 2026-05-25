use std::fs;
use std::path::PathBuf;
use std::process::Command;

use mstl_core::auth::{API_KEY_ENV_VAR, CONTROL_PLANE_API_PUBLIC_URL_ENV_VAR};

mod common;

#[test]
fn profile_version_setup_script_set_requires_api_key_env_var() {
    let script_file = write_setup_script_file(
        "profile_version_setup_script_set_requires_api_key_env_var",
        "#!/usr/bin/env bash\npnpm install\n",
    );

    let output = Command::new(env!("CARGO_BIN_EXE_mistle"))
        .args([
            "profile",
            "version",
            "setup-script",
            "set",
            "--profile",
            "sbp_test",
            "--version",
            "1",
            "--file",
            script_file
                .to_str()
                .expect("script path should be valid UTF-8"),
        ])
        .env_remove(API_KEY_ENV_VAR)
        .env_remove(CONTROL_PLANE_API_PUBLIC_URL_ENV_VAR)
        .env(
            "XDG_CONFIG_HOME",
            common::isolated_config_home("profile-version-setup-script-set"),
        )
        .output()
        .expect("mistle binary should run");

    fs::remove_file(script_file).expect("script file should be removed");

    assert!(!output.status.success());
    assert_eq!(String::from_utf8_lossy(&output.stdout), "");
    assert_eq!(
        String::from_utf8_lossy(&output.stderr),
        "missing Mistle authentication; run `mistle login` or set MISTLE_API_KEY\n"
    );
}

#[test]
fn profile_version_setup_script_set_rejects_empty_file() {
    let script_file =
        write_setup_script_file("profile_version_setup_script_set_rejects_empty_file", "");

    let output = Command::new(env!("CARGO_BIN_EXE_mistle"))
        .args([
            "profile",
            "version",
            "setup-script",
            "set",
            "--profile",
            "sbp_test",
            "--version",
            "1",
            "--file",
            script_file
                .to_str()
                .expect("script path should be valid UTF-8"),
        ])
        .env(API_KEY_ENV_VAR, "mstl_test_key")
        .env(CONTROL_PLANE_API_PUBLIC_URL_ENV_VAR, "http://127.0.0.1:1")
        .output()
        .expect("mistle binary should run");

    let expected_stderr = format!("file `{}` cannot be empty\n", script_file.display());
    fs::remove_file(script_file).expect("script file should be removed");

    assert!(!output.status.success());
    assert_eq!(String::from_utf8_lossy(&output.stdout), "");
    assert_eq!(String::from_utf8_lossy(&output.stderr), expected_stderr);
}

fn write_setup_script_file(test_name: &str, contents: &str) -> PathBuf {
    let file = std::env::temp_dir().join(format!("mistle-{test_name}-{}.sh", std::process::id()));
    fs::write(&file, contents).expect("script file should be written");
    file
}
