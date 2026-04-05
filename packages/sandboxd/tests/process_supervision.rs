use std::net::TcpStream;
use std::time::Duration;

use sandboxd::process::{self, RuntimeClientProcessSpec};
use sandboxd::runtime::{
    RuntimeArtifactCommand, RuntimeClientProcessReadiness, RuntimeClientProcessStopPolicy,
    RuntimeClientProcessStopSignal,
};

#[test]
fn starts_runtime_client_processes_and_waits_for_http_readiness() {
    let http_port = reserve_available_port();
    let process_spec = RuntimeClientProcessSpec {
        process_key: "http_server".to_string(),
        command: RuntimeArtifactCommand {
            args: vec![
                "node".to_string(),
                "-e".to_string(),
                format!(
                    "require('node:http').createServer((_, res) => res.end('ok')).listen({}, '127.0.0.1')",
                    http_port
                ),
            ],
            env: None,
            cwd: None,
            timeout_ms: None,
        },
        readiness: RuntimeClientProcessReadiness::Http {
            url: format!("http://127.0.0.1:{http_port}/"),
            expected_status: 200,
            timeout_ms: 5_000,
        },
        stop: RuntimeClientProcessStopPolicy {
            signal: RuntimeClientProcessStopSignal::Sigterm,
            timeout_ms: 5_000,
            grace_period_ms: Some(1_000),
        },
    };

    let manager = process::start_runtime_client_process_manager(&[process_spec])
        .expect("process manager should start and pass readiness");

    manager
        .stop()
        .expect("process manager should stop managed runtime clients");

    let connect_result = TcpStream::connect_timeout(
        &format!("127.0.0.1:{http_port}")
            .parse()
            .expect("socket addr should parse"),
        Duration::from_millis(200),
    );
    assert!(connect_result.is_err(), "process stop should close the readiness port");
}

#[test]
fn surfaces_readiness_failures_when_process_exits_early() {
    let process_spec = RuntimeClientProcessSpec {
        process_key: "exits_early".to_string(),
        command: RuntimeArtifactCommand {
            args: vec!["sh".to_string(), "-c".to_string(), "exit 7".to_string()],
            env: None,
            cwd: None,
            timeout_ms: None,
        },
        readiness: RuntimeClientProcessReadiness::Tcp {
            host: "127.0.0.1".to_string(),
            port: reserve_available_port(),
            timeout_ms: 1_000,
        },
        stop: RuntimeClientProcessStopPolicy {
            signal: RuntimeClientProcessStopSignal::Sigterm,
            timeout_ms: 1_000,
            grace_period_ms: Some(100),
        },
    };

    let error = process::start_runtime_client_process_manager(&[process_spec])
        .expect_err("readiness should fail when the process exits immediately");

    assert!(
        error
            .to_string()
            .contains("process exited with code 7"),
        "early exit should be reported in the readiness failure"
    );
}

fn reserve_available_port() -> u16 {
    let listener = std::net::TcpListener::bind("127.0.0.1:0")
        .expect("ephemeral port reservation should succeed");
    let port = listener
        .local_addr()
        .expect("listener local addr should exist")
        .port();
    drop(listener);
    port
}
