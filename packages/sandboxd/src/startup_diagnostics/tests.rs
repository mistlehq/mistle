use std::collections::BTreeMap;
use std::fs;
use std::thread;
use std::time::{Duration, UNIX_EPOCH};

use serde_json::Value;
use tokio::sync::mpsc;

use super::{
    ACTIVATE_LOG_PATH, ActivationDiagnosticsLogger, ActivationOperation,
    ActivationTranscriptStream, send_lifecycle_operation_record_with_timeout,
};
use crate::protocol::startup::ActivationOperationKind;
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

    let logger = ActivationDiagnosticsLogger::initialize(
        ActivationOperation::Activation {
            operation_kind: ActivationOperationKind::Start,
        },
        "ws://127.0.0.1:4000/tunnel/sandbox/sbi_test",
    )
    .expect("logger should initialize");
    logger
        .record_with_clock(
            &FixedClock,
            super::ActivationDiagnosticLevel::Info,
            "sandbox_start_started",
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
            ActivationTranscriptStream::Stdout,
            b"installing dependencies",
        )
        .expect("transcript record should append");
    logger
        .record_with_clock(
            &FixedClock,
            super::ActivationDiagnosticLevel::Error,
            "sandbox_start_phase_failed",
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

    let log_path = temp_dir.join("activate.log");
    let log_text = fs::read_to_string(&log_path).expect("log file should be readable");
    let lines = log_text.lines().collect::<Vec<_>>();
    assert!(lines.len() >= 4);
    let records = lines
        .iter()
        .map(|line| serde_json::from_str::<Value>(line).expect("log line should be valid json"))
        .collect::<Vec<_>>();
    assert!(records.iter().any(|record| {
        record["event"] == "sandbox_start_started" && record["sandboxInstanceId"] == "sbi_test"
    }));
    assert!(records.iter().any(|record| {
        record["event"] == "sandbox_start_phase_started" && record["phase"] == "apply_runtime_plan"
    }));
    assert!(records.iter().any(|record| {
        record["event"] == "sandbox_start_phase_completed"
            && record["phase"] == "apply_runtime_plan"
    }));
    assert!(records.iter().any(|record| {
        record["event"] == "sandbox_start_transcript"
            && record["phase"] == "apply_runtime_plan"
            && record["stream"] == "stdout"
            && record["message"] == "installing dependencies"
            && record["payloadBase64"] == "aW5zdGFsbGluZyBkZXBlbmRlbmNpZXM="
    }));
    assert!(records.iter().any(|record| {
        record["event"] == "sandbox_start_phase_failed"
            && record["phase"] == "apply_runtime_plan"
            && record["error"] == "workspace clone failed"
    }));

    let _ = fs::remove_dir_all(&temp_dir);
    assert_eq!(ACTIVATE_LOG_PATH, "/run/mistle/activate.log");
}

#[test]
fn activation_diagnostics_use_operation_kind_records() {
    let temp_dir = std::env::temp_dir().join(format!(
        "sandboxd-activation-diagnostics-{}-{:?}",
        std::process::id(),
        std::thread::current().id()
    ));
    let _ = fs::remove_dir_all(&temp_dir);
    fs::create_dir_all(&temp_dir).expect("temp dir should be creatable");
    let _log_dir_guard =
        TestEnvVarGuard::set(super::TEST_LOG_DIR_ENV, temp_dir.to_string_lossy().as_ref());

    let logger = ActivationDiagnosticsLogger::initialize(
        ActivationOperation::Activation {
            operation_kind: ActivationOperationKind::SetupCheck,
        },
        "ws://127.0.0.1:4000/tunnel/sandbox/sbi_test",
    )
    .expect("logger should initialize");
    logger
        .record_started()
        .expect("activation started record should append");
    logger
        .record_phase_started("apply_runtime_plan")
        .expect("activation phase start record should append");
    logger
        .record_transcript(
            Some("apply_runtime_plan"),
            ActivationTranscriptStream::Stdout,
            b"installing dependencies",
        )
        .expect("activation transcript record should append");

    let log_path = temp_dir.join("activate.log");
    let log_text = fs::read_to_string(&log_path).expect("log file should be readable");
    let records = log_text
        .lines()
        .map(|line| serde_json::from_str::<Value>(line).expect("log line should be valid json"))
        .collect::<Vec<_>>();
    assert!(records.iter().any(|record| {
        record["event"] == "sandbox_setup_check_started"
            && record["operation"] == "activate"
            && record["operationKind"] == "setup_check"
    }));
    assert!(records.iter().any(|record| {
        record["event"] == "sandbox_setup_check_phase_started"
            && record["operation"] == "activate"
            && record["operationKind"] == "setup_check"
            && record["phase"] == "apply_runtime_plan"
    }));
    assert!(records.iter().any(|record| {
        record["event"] == "sandbox_setup_check_transcript"
            && record["operation"] == "activate"
            && record["operationKind"] == "setup_check"
            && record["payloadBase64"] == "aW5zdGFsbGluZyBkZXBlbmRlbmNpZXM="
    }));

    let _ = fs::remove_dir_all(&temp_dir);
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
fn publishes_lifecycle_records_buffered_before_operation_sender_attachment() {
    let temp_dir = std::env::temp_dir().join(format!(
        "sandboxd-startup-diagnostics-buffered-records-{}-{:?}",
        std::process::id(),
        std::thread::current().id()
    ));
    let _ = fs::remove_dir_all(&temp_dir);
    fs::create_dir_all(&temp_dir).expect("temp dir should be creatable");
    let _log_dir_guard =
        TestEnvVarGuard::set(super::TEST_LOG_DIR_ENV, temp_dir.to_string_lossy().as_ref());

    let logger = ActivationDiagnosticsLogger::initialize(
        ActivationOperation::Activation {
            operation_kind: ActivationOperationKind::Start,
        },
        "ws://127.0.0.1:4000/tunnel/sandbox/sbi_test",
    )
    .expect("logger should initialize");
    logger
        .record_phase_started("start_tunnel_session")
        .expect("phase start record should append before sender attachment");

    let (sender, mut receiver) = mpsc::channel(8);
    logger.attach_operation_sender(sender);
    logger
        .record_phase_completed("start_tunnel_session")
        .expect("phase completion record should append after sender attachment");

    let started_record = receiver
        .blocking_recv()
        .expect("buffered phase start should publish after sender attachment");
    let OperationStreamMessage::Record(started_record) = started_record else {
        panic!("expected buffered lifecycle start record");
    };
    let started_record =
        serde_json::from_str::<Value>(&started_record).expect("start record should be json");
    assert_eq!(started_record["kind"], "lifecycle");
    assert_eq!(started_record["phase"], "operation_stream");
    assert_eq!(started_record["status"], "started");
    assert_eq!(
        started_record["attributes"]["phase"],
        "start_tunnel_session"
    );

    let completed_record = receiver
        .blocking_recv()
        .expect("phase completion should publish after sender attachment");
    let OperationStreamMessage::Record(completed_record) = completed_record else {
        panic!("expected lifecycle completion record");
    };
    let completed_record =
        serde_json::from_str::<Value>(&completed_record).expect("completion record should be json");
    assert_eq!(completed_record["kind"], "lifecycle");
    assert_eq!(completed_record["phase"], "operation_stream");
    assert_eq!(completed_record["status"], "completed");
    assert_eq!(
        completed_record["attributes"]["phase"],
        "start_tunnel_session"
    );

    let _ = fs::remove_dir_all(&temp_dir);
}

#[test]
fn publishes_activation_lifecycle_records_with_activation_operation_kind() {
    let temp_dir = std::env::temp_dir().join(format!(
        "sandboxd-activation-diagnostics-records-{}-{:?}",
        std::process::id(),
        std::thread::current().id()
    ));
    let _ = fs::remove_dir_all(&temp_dir);
    fs::create_dir_all(&temp_dir).expect("temp dir should be creatable");
    let _log_dir_guard =
        TestEnvVarGuard::set(super::TEST_LOG_DIR_ENV, temp_dir.to_string_lossy().as_ref());

    let logger = ActivationDiagnosticsLogger::initialize(
        ActivationOperation::Activation {
            operation_kind: ActivationOperationKind::Snapshot,
        },
        "ws://127.0.0.1:4000/tunnel/sandbox/sbi_test",
    )
    .expect("logger should initialize");
    let (sender, mut receiver) = mpsc::channel(8);
    logger.attach_operation_sender(sender);
    logger
        .record_phase_started("apply_runtime_plan")
        .expect("activation phase start record should append");

    let operation_record = receiver
        .blocking_recv()
        .expect("activation phase start should publish a lifecycle record");
    let OperationStreamMessage::Record(operation_record) = operation_record else {
        panic!("expected lifecycle record");
    };
    let operation_record =
        serde_json::from_str::<Value>(&operation_record).expect("record should be valid json");

    assert_eq!(operation_record["kind"], "lifecycle");
    assert_eq!(operation_record["phase"], "runtime_plan");
    assert_eq!(operation_record["status"], "started");
    assert_eq!(operation_record["attributes"]["operationKind"], "snapshot");

    let _ = fs::remove_dir_all(&temp_dir);
}

#[test]
fn maps_egress_start_and_stop_to_distinct_lifecycle_phases() {
    assert_eq!(
        super::operation_lifecycle_phase("start_egress_proxy"),
        Some("egress")
    );
    assert_eq!(
        super::operation_lifecycle_phase("stop_egress_proxy"),
        Some("teardown")
    );
}

#[test]
fn maps_cleanup_phases_to_the_resource_being_cleaned_up() {
    assert_eq!(
        super::operation_lifecycle_phase("stop_tunnel_session_after_runtime_plan_failure"),
        Some("operation_stream")
    );
    assert_eq!(
        super::operation_lifecycle_phase("stop_egress_proxy_after_setup_failure"),
        Some("teardown")
    );
}

#[test]
fn does_not_publish_top_level_sandboxd_lifecycle_operation_records() {
    let started_record = super::operation_record_line(
        ActivationOperation::Activation {
            operation_kind: ActivationOperationKind::Start,
        },
        "2026-05-21T00:00:00Z".to_string(),
        "sandbox_start_started",
        &serde_json::json!({
            "timestamp": "2026-05-21T00:00:00Z",
            "level": "info",
            "event": "sandbox_start_started",
            "sandboxInstanceId": "sbi_test",
            "operation": "activate"
        }),
    )
    .expect("started event should be processed");
    assert_eq!(started_record, None);

    let failed_record = super::operation_record_line(
        ActivationOperation::Activation {
            operation_kind: ActivationOperationKind::Start,
        },
        "2026-05-21T00:00:01Z".to_string(),
        "sandbox_activation_failed",
        &serde_json::json!({
            "timestamp": "2026-05-21T00:00:01Z",
            "level": "error",
            "event": "sandbox_activation_failed",
            "sandboxInstanceId": "sbi_test",
            "operation": "activate",
            "error": "runtime plan failed"
        }),
    )
    .expect("failed event should be processed");
    assert_eq!(failed_record, None);
}

#[test]
fn does_not_attribute_unknown_lifecycle_phases_to_sandboxd() {
    assert_eq!(
        super::operation_lifecycle_phase("unexpected_internal_phase"),
        None
    );

    let operation_record = super::operation_record_line(
        ActivationOperation::Activation {
            operation_kind: ActivationOperationKind::Start,
        },
        "2026-05-21T00:00:00Z".to_string(),
        "sandbox_start_phase_failed",
        &serde_json::json!({
            "timestamp": "2026-05-21T00:00:00Z",
            "level": "error",
            "event": "sandbox_start_phase_failed",
            "sandboxInstanceId": "sbi_test",
            "operation": "activate",
            "phase": "unexpected_internal_phase",
            "error": "failed"
        }),
    )
    .expect("unknown phase event should be processed");
    assert_eq!(operation_record, None);
}
