use std::collections::BTreeMap;
use std::fs;
use std::thread;
use std::time::{Duration, UNIX_EPOCH};

use serde_json::Value;
use tokio::sync::mpsc;

use super::{
    INIT_LOG_PATH, RESUME_LOG_PATH, StartupDiagnosticsLogger, StartupOperation,
    StartupTranscriptStream, send_lifecycle_operation_record_with_timeout,
};
use crate::test_support::TestEnvVarGuard;
use crate::time::Clock;
use crate::tunnel::session::OperationStreamMessage;

#[derive(Debug)]
struct FixedClock;

impl Clock for FixedClock {
    fn now_ms(&self) -> u64 {
        1_650_000_000_000
    }

    fn now_system_time(&self) -> std::time::SystemTime {
        UNIX_EPOCH + Duration::from_secs(1_650_000_000)
    }
}

#[test]
fn initializes_and_appends_operation_log_lines() {
    let temp_dir = std::env::temp_dir().join(format!(
        "sandboxd-startup-diagnostics-{}-{:?}",
        std::process::id(),
        std::thread::current().id()
    ));
    let _ = fs::remove_dir_all(&temp_dir);
    fs::create_dir_all(&temp_dir).expect("temp dir should be creatable");
    let _log_dir_guard =
        TestEnvVarGuard::set(super::TEST_LOG_DIR_ENV, temp_dir.to_string_lossy().as_ref());

    let logger = StartupDiagnosticsLogger::initialize(
        StartupOperation::Init,
        "ws://127.0.0.1:4000/tunnel/sandbox/sbi_test",
    )
    .expect("logger should initialize");
    logger
        .record_with_clock(
            &FixedClock,
            super::StartupDiagnosticLevel::Info,
            "sandbox_init_started",
            BTreeMap::new(),
        )
        .expect("started record should append");
    logger
        .record_phase_started("apply_runtime_plan")
        .expect("phase start record should append");
    logger
        .record_phase_completed("apply_runtime_plan")
        .expect("phase completion record should append");
    logger
        .record_transcript(
            Some("apply_runtime_plan"),
            StartupTranscriptStream::Stdout,
            b"installing dependencies",
        )
        .expect("transcript record should append");
    logger
        .record_with_clock(
            &FixedClock,
            super::StartupDiagnosticLevel::Error,
            "sandbox_init_phase_failed",
            BTreeMap::from([
                (
                    "phase".to_string(),
                    Value::String("apply_runtime_plan".to_string()),
                ),
                (
                    "error".to_string(),
                    Value::String("workspace clone failed".to_string()),
                ),
            ]),
        )
        .expect("failure record should append");

    let log_path = temp_dir.join("init.log");
    let log_text = fs::read_to_string(&log_path).expect("log file should be readable");
    let lines = log_text.lines().collect::<Vec<_>>();
    assert!(lines.len() >= 4);
    let records = lines
        .iter()
        .map(|line| serde_json::from_str::<Value>(line).expect("log line should be valid json"))
        .collect::<Vec<_>>();
    assert!(records.iter().any(|record| {
        record["event"] == "sandbox_init_started" && record["sandboxInstanceId"] == "sbi_test"
    }));
    assert!(records.iter().any(|record| {
        record["event"] == "sandbox_init_phase_started" && record["phase"] == "apply_runtime_plan"
    }));
    assert!(records.iter().any(|record| {
        record["event"] == "sandbox_init_phase_completed" && record["phase"] == "apply_runtime_plan"
    }));
    assert!(records.iter().any(|record| {
        record["event"] == "sandbox_init_transcript"
            && record["phase"] == "apply_runtime_plan"
            && record["stream"] == "stdout"
            && record["message"] == "installing dependencies"
            && record["payloadBase64"] == "aW5zdGFsbGluZyBkZXBlbmRlbmNpZXM="
    }));
    assert!(records.iter().any(|record| {
        record["event"] == "sandbox_init_phase_failed"
            && record["phase"] == "apply_runtime_plan"
            && record["error"] == "workspace clone failed"
    }));

    let _ = fs::remove_dir_all(&temp_dir);
    assert_eq!(INIT_LOG_PATH, "/run/mistle/init.log");
    assert_eq!(RESUME_LOG_PATH, "/run/mistle/resume.log");
}

#[test]
fn lifecycle_operation_record_waits_for_operation_channel_capacity() {
    let (sender, mut receiver) = mpsc::channel(1);
    sender
        .try_send(OperationStreamMessage::Record("first\n".to_string()))
        .expect("test channel should accept the first record");
    let (observed_sender, observed_receiver) = std::sync::mpsc::channel();

    let receiver_thread = thread::spawn(move || {
        thread::sleep(Duration::from_millis(25));
        let _ = receiver
            .blocking_recv()
            .expect("first record should be queued");
        let second_record = receiver
            .blocking_recv()
            .expect("second record should be delivered after capacity frees");
        let OperationStreamMessage::Record(line) = second_record else {
            panic!("expected a lifecycle operation record");
        };
        observed_sender
            .send(line)
            .expect("test should observe the second record");
    });

    send_lifecycle_operation_record_with_timeout(
        sender,
        OperationStreamMessage::Record("second\n".to_string()),
    );

    let observed_record = observed_receiver
        .recv_timeout(Duration::from_secs(1))
        .expect("second lifecycle record should be delivered");
    assert_eq!(observed_record, "second\n");
    receiver_thread
        .join()
        .expect("receiver thread should exit cleanly");
}

#[test]
fn maps_egress_start_and_stop_to_distinct_lifecycle_phases() {
    assert_eq!(
        super::operation_lifecycle_phase("start_egress_proxy"),
        "egress"
    );
    assert_eq!(
        super::operation_lifecycle_phase("stop_egress_proxy"),
        "teardown"
    );
}
