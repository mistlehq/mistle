use std::collections::BTreeMap;
use std::collections::BTreeSet;
use std::fs;
use std::net::TcpListener;
use std::path::{Path, PathBuf};
use std::thread;
use std::time::{Duration, Instant};

use sandboxd::process::{
    RuntimeClientProcessSpec, start_runtime_client_process_manager_with_supervisor,
};
use sandboxd::runtime::{
    RuntimeClientProcessReadiness, RuntimeClientProcessStopPolicy, RuntimeClientProcessStopSignal,
    RuntimeExecCommand,
};
use sandboxd::supervision::{ComponentHealthState, SandboxdSupervisorHandle, SupervisedComponent};
use sandboxd::time::{SystemClock, ThreadSleeper};

#[test]
fn records_codex_app_server_exit_after_readiness() {
    let port = reserve_test_port();
    let process_spec = codex_app_server_process_spec(port, "exit", 250);
    let supervisor_handle = SandboxdSupervisorHandle::new(
        "sandbox-123",
        std::sync::Arc::new(SystemClock),
        BTreeSet::from([SupervisedComponent::CodexAppServer]),
    );

    let process_manager = start_runtime_client_process_manager_with_supervisor(
        std::slice::from_ref(&process_spec),
        &SystemClock,
        &ThreadSleeper,
        supervisor_handle.clone(),
    )
    .expect("process manager should start");
    let observation_handle = process_manager
        .codex_app_server_observation_handle()
        .expect("Codex app-server observation handle should exist")
        .clone();

    wait_for_codex_app_server_snapshot(
        &supervisor_handle,
        ComponentHealthState::Restarting,
        1,
        Duration::from_secs(5),
    );

    let observation = observation_handle.snapshot();
    assert_eq!(observation.process_key, "codex-app-server");
    assert_eq!(
        observation.readiness_url,
        Some(format!("ws://127.0.0.1:{port}/health"))
    );
    assert!(!observation.is_alive);
    assert_eq!(
        observation.last_exit_status,
        Some("process exited".to_string())
    );

    let snapshot = supervisor_handle
        .component_snapshot(SupervisedComponent::CodexAppServer)
        .expect("Codex app-server should be tracked");
    assert_eq!(
        snapshot.details.get("lastExitStatus"),
        Some(&"process exited".to_string())
    );
    assert_eq!(
        snapshot.details.get("livenessState"),
        Some(&"Exited".to_string())
    );
    assert!(
        wait_for_forwarded_lifecycle_event(
            &supervisor_handle,
            "\"event\":\"component_exited\"",
            Duration::from_secs(5),
        ),
        "expected a forwarded component_exited lifecycle event for the Codex app-server"
    );

    process_manager
        .stop(&SystemClock, &ThreadSleeper)
        .expect("process manager stop should succeed after exit observation");
}

#[test]
fn records_codex_app_server_readiness_degradation_while_process_stays_alive() {
    let port = reserve_test_port();
    let process_spec = codex_app_server_process_spec(port, "degrade", 250);
    let supervisor_handle = SandboxdSupervisorHandle::new(
        "sandbox-123",
        std::sync::Arc::new(SystemClock),
        BTreeSet::from([SupervisedComponent::CodexAppServer]),
    );

    let process_manager = start_runtime_client_process_manager_with_supervisor(
        &[process_spec],
        &SystemClock,
        &ThreadSleeper,
        supervisor_handle.clone(),
    )
    .expect("process manager should start");
    let observation_handle = process_manager
        .codex_app_server_observation_handle()
        .expect("Codex app-server observation handle should exist")
        .clone();

    assert!(
        wait_for_forwarded_lifecycle_event(
            &supervisor_handle,
            "\"probeKind\":\"readiness_ws\"",
            Duration::from_secs(5),
        ),
        "expected a readiness_ws healthcheck failure event for the Codex app-server"
    );

    let observation = observation_handle.snapshot();
    assert!(observation.is_alive);
    assert_eq!(observation.last_exit_status, None);

    let snapshot = supervisor_handle
        .component_snapshot(SupervisedComponent::CodexAppServer)
        .expect("Codex app-server should be tracked");
    assert_eq!(snapshot.state, ComponentHealthState::Restarting);
    assert_eq!(
        snapshot.details.get("readinessState"),
        Some(&"Unreachable".to_string())
    );

    process_manager
        .stop(&SystemClock, &ThreadSleeper)
        .expect("process manager stop should succeed");
}

#[test]
fn codex_app_server_monitor_survives_a_failed_restart_attempt() {
    let port = reserve_test_port();
    let control_dir = create_test_control_dir("codex-app-server-restart");
    let exit_marker_path = control_dir.join("exit-now");
    let process_spec = codex_app_server_restart_process_spec(port, &control_dir);
    let supervisor_handle = SandboxdSupervisorHandle::new(
        "sandbox-123",
        std::sync::Arc::new(SystemClock),
        BTreeSet::from([SupervisedComponent::CodexAppServer]),
    );

    let process_manager = start_runtime_client_process_manager_with_supervisor(
        std::slice::from_ref(&process_spec),
        &SystemClock,
        &ThreadSleeper,
        supervisor_handle.clone(),
    )
    .expect("process manager should start");
    let control_handle = process_manager
        .codex_app_server_control_handle()
        .expect("Codex app-server control handle should exist")
        .clone();

    let restart_error = control_handle
        .restart(&SystemClock, &ThreadSleeper)
        .expect_err("the first coordinated restart attempt should fail");
    assert!(
        restart_error.contains("process exited"),
        "expected the failed restart attempt to report the exited replacement child, got: {restart_error}"
    );
    wait_for_codex_app_server_snapshot(
        &supervisor_handle,
        ComponentHealthState::Restarting,
        1,
        Duration::from_secs(5),
    );

    control_handle
        .restart(&SystemClock, &ThreadSleeper)
        .expect("the second coordinated restart attempt should succeed");
    wait_for_codex_app_server_snapshot(
        &supervisor_handle,
        ComponentHealthState::Healthy,
        1,
        Duration::from_secs(5),
    );

    fs::write(&exit_marker_path, "exit-now").expect("exit marker should be writable");
    wait_for_codex_app_server_snapshot(
        &supervisor_handle,
        ComponentHealthState::Restarting,
        2,
        Duration::from_secs(5),
    );

    process_manager
        .stop(&SystemClock, &ThreadSleeper)
        .expect("process manager stop should succeed after restart monitoring");
    let _ = fs::remove_file(exit_marker_path);
    let _ = fs::remove_dir_all(control_dir);
}

fn codex_app_server_process_spec(port: u16, mode: &str, delay_ms: u64) -> RuntimeClientProcessSpec {
    let script = r#"
const net = require('node:net');
const [portArg, mode, delayArg] = process.argv.slice(1);
const port = Number(portArg);
const delayMs = Number(delayArg);
const keepAlive = setInterval(() => {}, 1000);
const server = net.createServer((socket) => {
  socket.once('data', () => {
    socket.write(
      'HTTP/1.1 101 Switching Protocols\r\n' +
      'Connection: Upgrade\r\n' +
      'Upgrade: websocket\r\n' +
      'Sec-WebSocket-Accept: sandboxd-test\r\n' +
      '\r\n',
    );
  });
});
server.listen(port, '127.0.0.1', () => {
  setTimeout(() => {
    if (mode === 'exit') {
      server.close(() => {
        clearInterval(keepAlive);
        process.exit(0);
      });
      return;
    }
    if (mode === 'degrade') {
      server.close(() => {});
    }
  }, delayMs);
});
"#;

    RuntimeClientProcessSpec {
        process_key: "codex-app-server".to_string(),
        command: RuntimeExecCommand {
            args: vec![
                "node".to_string(),
                "-e".to_string(),
                script.to_string(),
                port.to_string(),
                mode.to_string(),
                delay_ms.to_string(),
            ],
            env: Some(BTreeMap::new()),
            cwd: None,
            timeout_ms: None,
        },
        readiness: RuntimeClientProcessReadiness::Ws {
            url: format!("ws://127.0.0.1:{port}/health"),
            timeout_ms: 5_000,
        },
        stop: RuntimeClientProcessStopPolicy {
            signal: RuntimeClientProcessStopSignal::Sigkill,
            timeout_ms: 1_000,
            grace_period_ms: None,
        },
    }
}

fn codex_app_server_restart_process_spec(
    port: u16,
    control_dir: &Path,
) -> RuntimeClientProcessSpec {
    let script = r#"
const fs = require('node:fs');
const path = require('node:path');
const net = require('node:net');

const [portArg, controlDirArg] = process.argv.slice(1);
const port = Number(portArg);
const controlDir = controlDirArg;
const attemptPath = path.join(controlDir, 'attempt.txt');
const exitMarkerPath = path.join(controlDir, 'exit-now');

let attempt = 0;
try {
  attempt = Number(fs.readFileSync(attemptPath, 'utf8').trim() || '0');
} catch {}
attempt += 1;
fs.writeFileSync(attemptPath, String(attempt));

const failThisAttempt = attempt === 2;
const keepAlive = setInterval(() => {}, 1000);
let exitWatcher = null;
const server = net.createServer((socket) => {
  socket.once('data', () => {
    socket.write(
      'HTTP/1.1 101 Switching Protocols\r\n' +
      'Connection: Upgrade\r\n' +
      'Upgrade: websocket\r\n' +
      'Sec-WebSocket-Accept: sandboxd-test\r\n' +
      '\r\n',
    );
  });
});

function shutdown(code) {
  if (exitWatcher !== null) {
    clearInterval(exitWatcher);
  }
  server.close(() => {
    clearInterval(keepAlive);
    process.exit(code);
  });
}

if (failThisAttempt) {
  setTimeout(() => {
    clearInterval(keepAlive);
    process.exit(1);
  }, 150);
} else {
  server.listen(port, '127.0.0.1', () => {
    exitWatcher = setInterval(() => {
      if (fs.existsSync(exitMarkerPath)) {
        shutdown(0);
      }
    }, 50);
  });
}
"#;

    RuntimeClientProcessSpec {
        process_key: "codex-app-server".to_string(),
        command: RuntimeExecCommand {
            args: vec![
                "node".to_string(),
                "-e".to_string(),
                script.to_string(),
                port.to_string(),
                control_dir.display().to_string(),
            ],
            env: Some(BTreeMap::new()),
            cwd: None,
            timeout_ms: None,
        },
        readiness: RuntimeClientProcessReadiness::Ws {
            url: format!("ws://127.0.0.1:{port}/health"),
            timeout_ms: 5_000,
        },
        stop: RuntimeClientProcessStopPolicy {
            signal: RuntimeClientProcessStopSignal::Sigkill,
            timeout_ms: 1_000,
            grace_period_ms: None,
        },
    }
}

fn reserve_test_port() -> u16 {
    let listener =
        TcpListener::bind(("127.0.0.1", 0)).expect("test listener should bind to loopback");
    let address = listener
        .local_addr()
        .expect("test listener should expose its bound address");
    drop(listener);
    address.port()
}

fn create_test_control_dir(prefix: &str) -> PathBuf {
    let directory = std::env::temp_dir().join(format!(
        "{prefix}-{}-{}",
        std::process::id(),
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .expect("system time should be after unix epoch")
            .as_nanos()
    ));
    fs::create_dir_all(&directory).expect("test control directory should be creatable");
    directory
}

fn wait_for_codex_app_server_snapshot(
    supervisor_handle: &SandboxdSupervisorHandle,
    expected_state: ComponentHealthState,
    expected_restart_count: u64,
    timeout: Duration,
) {
    let deadline = Instant::now() + timeout;
    loop {
        let snapshot = supervisor_handle
            .component_snapshot(SupervisedComponent::CodexAppServer)
            .expect("Codex app-server should be tracked");
        if snapshot.state == expected_state && snapshot.restart_count >= expected_restart_count {
            return;
        }

        assert!(
            Instant::now() < deadline,
            "expected Codex app-server snapshot to reach state {expected_state:?} with restart_count >= {expected_restart_count}, got {snapshot:?}"
        );
        thread::sleep(Duration::from_millis(25));
    }
}

fn wait_for_forwarded_lifecycle_event(
    supervisor_handle: &SandboxdSupervisorHandle,
    expected_fragment: &str,
    timeout: Duration,
) -> bool {
    let deadline = Instant::now() + timeout;
    loop {
        let lifecycle_lines = supervisor_handle.drain_forwarded_lifecycle_event_lines();
        if lifecycle_lines
            .iter()
            .any(|line| line.contains(expected_fragment) && line.contains("\"CodexAppServer\""))
        {
            return true;
        }
        if Instant::now() >= deadline {
            return false;
        }
        thread::sleep(Duration::from_millis(25));
    }
}
