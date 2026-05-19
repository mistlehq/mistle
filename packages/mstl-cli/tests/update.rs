use std::process::Command;

#[test]
fn update_help_describes_the_update_command_without_running_it() {
    let output = Command::new(env!("CARGO_BIN_EXE_mistle"))
        .args(["update", "--help"])
        .output()
        .expect("mistle binary should run");

    assert!(
        output.status.success(),
        "stderr: {}",
        String::from_utf8_lossy(&output.stderr)
    );
    assert_eq!(String::from_utf8_lossy(&output.stderr), "");

    let stdout = String::from_utf8_lossy(&output.stdout);
    assert!(stdout.contains("Update the Mistle CLI"));
    assert!(stdout.contains("Usage: mistle update"));
}
