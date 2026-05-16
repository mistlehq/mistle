use std::process::Command;

#[test]
fn cli_prints_the_package_version_for_long_version_flag() {
    let output = Command::new(env!("CARGO_BIN_EXE_mstl"))
        .arg("--version")
        .output()
        .expect("mstl binary should run");

    assert!(
        output.status.success(),
        "stderr: {}",
        String::from_utf8_lossy(&output.stderr)
    );
    assert_eq!(version_output(&output.stdout), expected_version_output());
    assert_eq!(String::from_utf8_lossy(&output.stderr), "");
}

#[test]
fn cli_prints_the_package_version_for_short_version_flag() {
    let output = Command::new(env!("CARGO_BIN_EXE_mstl"))
        .arg("-V")
        .output()
        .expect("mstl binary should run");

    assert!(
        output.status.success(),
        "stderr: {}",
        String::from_utf8_lossy(&output.stderr)
    );
    assert_eq!(version_output(&output.stdout), expected_version_output());
    assert_eq!(String::from_utf8_lossy(&output.stderr), "");
}

fn version_output(output: &[u8]) -> String {
    String::from_utf8_lossy(output).into_owned()
}

fn expected_version_output() -> String {
    format!("Version: {}\n\n", env!("CARGO_PKG_VERSION"))
}
