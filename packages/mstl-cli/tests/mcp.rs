use std::process::Command;

#[test]
fn mcp_help_describes_the_mcp_namespace_without_running_it() {
    let output = Command::new(env!("CARGO_BIN_EXE_mistle"))
        .args(["mcp", "--help"])
        .output()
        .expect("mistle binary should run");

    assert!(
        output.status.success(),
        "stderr: {}",
        String::from_utf8_lossy(&output.stderr)
    );
    assert_eq!(String::from_utf8_lossy(&output.stderr), "");

    let stdout = String::from_utf8_lossy(&output.stdout);
    assert!(stdout.contains("Run Mistle MCP interfaces"));
    assert!(stdout.contains("serve"));
}

#[test]
fn mcp_serve_help_describes_the_streamable_http_server_without_running_it() {
    let output = Command::new(env!("CARGO_BIN_EXE_mistle"))
        .args(["mcp", "serve", "--help"])
        .output()
        .expect("mistle binary should run");

    assert!(
        output.status.success(),
        "stderr: {}",
        String::from_utf8_lossy(&output.stderr)
    );
    assert_eq!(String::from_utf8_lossy(&output.stderr), "");

    let stdout = String::from_utf8_lossy(&output.stdout);
    assert!(stdout.contains("Serve the Mistle MCP server over Streamable HTTP"));
    assert!(stdout.contains("--host"));
    assert!(stdout.contains("--port"));
    assert!(stdout.contains("Usage: mistle mcp serve"));
}
