use std::net::TcpStream;
use std::time::Duration;

use sandboxd::process::{self, RuntimeClientProcessSpec};
use sandboxd::runtime::{
    RuntimeArtifactCommand, RuntimeClientProcessReadiness, RuntimeClientProcessStopPolicy,
    RuntimeClientProcessStopSignal,
};
use sandboxd::time::{SystemClock, ThreadSleeper};

#[test]
fn starts_runtime_client_processes_and_waits_for_tcp_readiness() {
    let tcp_port = reserve_available_port();
    let process_spec = RuntimeClientProcessSpec {
        process_key: "tcp_server".to_string(),
        command: node_process(&format!(
            "require('node:net').createServer(() => {{}}).listen({}, '127.0.0.1')",
            tcp_port
        )),
        readiness: RuntimeClientProcessReadiness::Tcp {
            host: "127.0.0.1".to_string(),
            port: tcp_port,
            timeout_ms: 5_000,
        },
        stop: default_stop_policy(),
    };

    let manager = process::start_runtime_client_process_manager(
        &[process_spec],
        &SystemClock,
        &ThreadSleeper,
    )
    .expect("process manager should start and pass tcp readiness");

    manager
        .stop(&SystemClock, &ThreadSleeper)
        .expect("process manager should stop managed runtime clients");

    let connect_result = TcpStream::connect_timeout(
        &format!("127.0.0.1:{tcp_port}")
            .parse()
            .expect("socket addr should parse"),
        Duration::from_millis(200),
    );
    assert!(
        connect_result.is_err(),
        "process stop should close the tcp readiness port"
    );
}

#[test]
fn starts_runtime_client_processes_and_waits_for_http_readiness() {
    let http_port = reserve_available_port();
    let process_spec = RuntimeClientProcessSpec {
        process_key: "http_server".to_string(),
        command: node_process(&format!(
            "require('node:http').createServer((_, res) => res.end('ok')).listen({}, '127.0.0.1')",
            http_port
        )),
        readiness: RuntimeClientProcessReadiness::Http {
            url: format!("http://127.0.0.1:{http_port}/"),
            expected_status: 200,
            timeout_ms: 5_000,
        },
        stop: default_stop_policy(),
    };

    let manager = process::start_runtime_client_process_manager(
        &[process_spec],
        &SystemClock,
        &ThreadSleeper,
    )
    .expect("process manager should start and pass readiness");

    manager
        .stop(&SystemClock, &ThreadSleeper)
        .expect("process manager should stop managed runtime clients");

    let connect_result = TcpStream::connect_timeout(
        &format!("127.0.0.1:{http_port}")
            .parse()
            .expect("socket addr should parse"),
        Duration::from_millis(200),
    );
    assert!(
        connect_result.is_err(),
        "process stop should close the readiness port"
    );
}

#[test]
fn starts_runtime_client_processes_and_waits_for_websocket_readiness() {
    let ws_port = reserve_available_port();
    let process_spec = RuntimeClientProcessSpec {
        process_key: "ws_server".to_string(),
        command: node_process(&format!(
            "const http = require('node:http'); \
             http.createServer().on('upgrade', (_req, socket) => {{ \
               socket.write('HTTP/1.1 101 Switching Protocols\\r\\nConnection: Upgrade\\r\\nUpgrade: websocket\\r\\n\\r\\n'); \
             }}).listen({}, '127.0.0.1')",
            ws_port
        )),
        readiness: RuntimeClientProcessReadiness::Ws {
            url: format!("ws://127.0.0.1:{ws_port}/"),
            timeout_ms: 5_000,
        },
        stop: default_stop_policy(),
    };

    let manager = process::start_runtime_client_process_manager(
        &[process_spec],
        &SystemClock,
        &ThreadSleeper,
    )
    .expect("process manager should start and pass websocket readiness");

    manager
        .stop(&SystemClock, &ThreadSleeper)
        .expect("process manager should stop managed runtime clients");
}

#[test]
fn starts_runtime_client_processes_without_readiness_probe_when_none_is_configured() {
    let process_spec = RuntimeClientProcessSpec {
        process_key: "no_probe".to_string(),
        command: node_process("setInterval(() => {}, 1000)"),
        readiness: RuntimeClientProcessReadiness::None,
        stop: default_stop_policy(),
    };

    let manager = process::start_runtime_client_process_manager(
        &[process_spec],
        &SystemClock,
        &ThreadSleeper,
    )
    .expect("process manager should start immediately when no readiness probe is configured");

    manager
        .stop(&SystemClock, &ThreadSleeper)
        .expect("process manager should stop managed runtime clients");
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

    let error = process::start_runtime_client_process_manager(
        &[process_spec],
        &SystemClock,
        &ThreadSleeper,
    )
    .expect_err("readiness should fail when the process exits immediately");

    assert!(
        error.to_string().contains("process exited with code 7"),
        "early exit should be reported in the readiness failure"
    );
}

fn node_process(source: &str) -> RuntimeArtifactCommand {
    RuntimeArtifactCommand {
        args: vec!["node".to_string(), "-e".to_string(), source.to_string()],
        env: None,
        cwd: None,
        timeout_ms: None,
    }
}

fn default_stop_policy() -> RuntimeClientProcessStopPolicy {
    RuntimeClientProcessStopPolicy {
        signal: RuntimeClientProcessStopSignal::Sigterm,
        timeout_ms: 5_000,
        grace_period_ms: Some(1_000),
    }
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
