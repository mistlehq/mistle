use std::collections::BTreeMap;
use std::fs::{self, OpenOptions};
use std::io::Write;
use std::path::PathBuf;
use std::sync::{Arc, Mutex, OnceLock};
use std::time::{Duration, Instant};

use base64::Engine;
use base64::engine::general_purpose::STANDARD as Base64Standard;
use serde_json::{Map, Number, Value, json};
use tokio::sync::mpsc;

use crate::time::{Clock, SystemClock, format_rfc3339_timestamp};
use crate::tunnel::session::{OperationStreamMessage, derive_sandbox_instance_id};

pub const INIT_LOG_PATH: &str = "/run/mistle/init.log";
pub const RESUME_LOG_PATH: &str = "/run/mistle/resume.log";

const TEST_LOG_DIR_ENV: &str = "MISTLE_SANDBOXD_OPERATION_LOG_DIR";
const OPERATION_STREAM_CLOSE_TIMEOUT: Duration = Duration::from_secs(2);
const LIFECYCLE_OPERATION_RECORD_SEND_TIMEOUT: Duration = Duration::from_millis(500);
const LIFECYCLE_OPERATION_RECORD_SEND_RETRY_INTERVAL: Duration = Duration::from_millis(5);

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum StartupOperation {
    Init,
    Resume,
}

impl StartupOperation {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Init => "init",
            Self::Resume => "resume",
        }
    }

    fn default_log_path(self) -> &'static str {
        match self {
            Self::Init => INIT_LOG_PATH,
            Self::Resume => RESUME_LOG_PATH,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum StartupDiagnosticLevel {
    Info,
    Error,
}

impl StartupDiagnosticLevel {
    fn as_str(self) -> &'static str {
        match self {
            Self::Info => "info",
            Self::Error => "error",
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum StartupTranscriptStream {
    Stdout,
    Stderr,
    System,
}

impl StartupTranscriptStream {
    fn as_str(self) -> &'static str {
        match self {
            Self::Stdout => "stdout",
            Self::Stderr => "stderr",
            Self::System => "system",
        }
    }
}

#[derive(Clone)]
pub struct StartupDiagnosticsLogger {
    inner: Arc<StartupDiagnosticsLoggerInner>,
}

struct StartupDiagnosticsLoggerInner {
    sandbox_instance_id: String,
    operation: StartupOperation,
    path: PathBuf,
    operation_sender: Mutex<Option<mpsc::Sender<OperationStreamMessage>>>,
}

impl StartupDiagnosticsLogger {
    pub fn initialize(
        operation: StartupOperation,
        tunnel_gateway_ws_url: &str,
    ) -> Result<Self, String> {
        let sandbox_instance_id = derive_sandbox_instance_id(tunnel_gateway_ws_url)
            .map_err(|error| format!("failed to derive sandbox instance id: {error}"))?;
        let path = operation_log_path(operation);
        let parent = path.parent().ok_or_else(|| {
            format!(
                "startup operation log path {} has no parent",
                path.display()
            )
        })?;
        fs::create_dir_all(parent).map_err(|error| {
            format!(
                "failed to create startup operation log directory {}: {error}",
                parent.display()
            )
        })?;
        OpenOptions::new()
            .create(true)
            .truncate(true)
            .write(true)
            .open(&path)
            .map_err(|error| {
                format!(
                    "failed to initialize startup operation log {}: {error}",
                    path.display()
                )
            })?;

        Ok(Self {
            inner: Arc::new(StartupDiagnosticsLoggerInner {
                sandbox_instance_id,
                operation,
                path,
                operation_sender: Mutex::new(None),
            }),
        })
    }

    pub fn attach_operation_sender(&self, sender: mpsc::Sender<OperationStreamMessage>) {
        let mut operation_sender = self
            .inner
            .operation_sender
            .lock()
            .expect("startup diagnostics operation sender lock should not be poisoned");
        *operation_sender = Some(sender);
    }

    pub fn close_operation_stream(&self) {
        let mut operation_sender = self
            .inner
            .operation_sender
            .lock()
            .expect("startup diagnostics operation sender lock should not be poisoned");
        if let Some(sender) = operation_sender.take() {
            let (response_sender, response_receiver) = std::sync::mpsc::channel();
            if let Err(error) = sender.try_send(OperationStreamMessage::Close { response_sender }) {
                eprintln!("sandboxd failed to request operation stream close: {error}");
                return;
            }

            match response_receiver.recv_timeout(OPERATION_STREAM_CLOSE_TIMEOUT) {
                Ok(Ok(())) => {}
                Ok(Err(error)) => {
                    eprintln!("sandboxd failed to flush operation stream before close: {error}");
                }
                Err(error) => {
                    eprintln!("sandboxd timed out waiting for operation stream close: {error}");
                }
            }
        }
    }

    pub fn record_started(&self) -> Result<(), String> {
        self.record_with_clock(
            &SystemClock,
            StartupDiagnosticLevel::Info,
            started_event_name(self.inner.operation),
            BTreeMap::new(),
        )
    }

    pub fn record_phase_failed(
        &self,
        phase: &str,
        mut attributes: BTreeMap<String, Value>,
    ) -> Result<(), String> {
        attributes.insert("phase".to_string(), Value::String(phase.to_string()));
        self.record_with_clock(
            &SystemClock,
            StartupDiagnosticLevel::Error,
            phase_failed_event_name(self.inner.operation),
            attributes,
        )
    }

    pub fn record_phase_started(&self, phase: &str) -> Result<(), String> {
        self.record_with_clock(
            &SystemClock,
            StartupDiagnosticLevel::Info,
            phase_started_event_name(self.inner.operation),
            BTreeMap::from([("phase".to_string(), Value::String(phase.to_string()))]),
        )
    }

    pub fn record_phase_completed(&self, phase: &str) -> Result<(), String> {
        self.record_phase_completed_with_attributes(phase, BTreeMap::new())
    }

    pub fn record_phase_completed_with_attributes(
        &self,
        phase: &str,
        mut attributes: BTreeMap<String, Value>,
    ) -> Result<(), String> {
        attributes.insert("phase".to_string(), Value::String(phase.to_string()));
        self.record_with_clock(
            &SystemClock,
            StartupDiagnosticLevel::Info,
            phase_completed_event_name(self.inner.operation),
            attributes,
        )
    }

    pub fn record_failed(&self, mut attributes: BTreeMap<String, Value>) -> Result<(), String> {
        self.record_with_clock(
            &SystemClock,
            StartupDiagnosticLevel::Error,
            failed_event_name(self.inner.operation),
            {
                attributes.remove("operation");
                attributes
            },
        )
    }

    pub fn record_transcript(
        &self,
        phase: Option<&str>,
        stream: StartupTranscriptStream,
        payload: &[u8],
    ) -> Result<(), String> {
        let message = String::from_utf8_lossy(payload);
        let mut attributes = BTreeMap::from([
            (
                "stream".to_string(),
                Value::String(stream.as_str().to_string()),
            ),
            ("message".to_string(), Value::String(message.to_string())),
            (
                "payloadBase64".to_string(),
                Value::String(Base64Standard.encode(payload)),
            ),
        ]);
        if let Some(phase) = phase {
            attributes.insert("phase".to_string(), Value::String(phase.to_string()));
        }

        self.record_with_clock(
            &SystemClock,
            StartupDiagnosticLevel::Info,
            transcript_event_name(self.inner.operation),
            attributes,
        )
    }

    fn record_with_clock(
        &self,
        clock: &dyn Clock,
        level: StartupDiagnosticLevel,
        event: &str,
        attributes: BTreeMap<String, Value>,
    ) -> Result<(), String> {
        let timestamp = format_rfc3339_timestamp(clock.now_system_time())
            .map_err(|error| format!("failed to format startup diagnostic timestamp: {error}"))?;
        let mut payload = Map::new();
        payload.insert("timestamp".to_string(), Value::String(timestamp.clone()));
        payload.insert(
            "level".to_string(),
            Value::String(level.as_str().to_string()),
        );
        payload.insert("event".to_string(), Value::String(event.to_string()));
        payload.insert(
            "sandboxInstanceId".to_string(),
            Value::String(self.inner.sandbox_instance_id.clone()),
        );
        payload.insert(
            "operation".to_string(),
            Value::String(self.inner.operation.as_str().to_string()),
        );

        for (key, value) in attributes {
            payload.insert(key, value);
        }

        let payload_value = Value::Object(payload);
        let mut line = serde_json::to_string(&payload_value)
            .map_err(|error| format!("failed to serialize startup diagnostic event: {error}"))?;
        line.push('\n');

        let mut file = OpenOptions::new()
            .create(true)
            .append(true)
            .open(&self.inner.path)
            .map_err(|error| {
                format!(
                    "failed to open startup diagnostic log {} for append: {error}",
                    self.inner.path.display()
                )
            })?;
        file.write_all(line.as_bytes()).map_err(|error| {
            format!(
                "failed to append startup diagnostic log {}: {error}",
                self.inner.path.display()
            )
        })?;

        if let Some(operation_record) =
            operation_record_line(self.inner.operation, timestamp, event, &payload_value)?
        {
            self.publish_operation_record(event, operation_record);
        }

        Ok(())
    }

    fn publish_operation_record(&self, event: &str, operation_record: String) {
        let operation_sender = self
            .inner
            .operation_sender
            .lock()
            .expect("startup diagnostics operation sender lock should not be poisoned")
            .clone();
        let Some(sender) = operation_sender else {
            return;
        };

        let operation_record = OperationStreamMessage::Record(operation_record);
        if event == transcript_event_name(self.inner.operation) {
            if let Err(error) = sender.try_send(operation_record) {
                eprintln!("sandboxd dropped operation transcript record: {error}");
            }
            return;
        }

        send_lifecycle_operation_record_with_timeout(sender, operation_record);
    }
}

fn send_lifecycle_operation_record_with_timeout(
    sender: mpsc::Sender<OperationStreamMessage>,
    mut operation_record: OperationStreamMessage,
) {
    let deadline = Instant::now() + LIFECYCLE_OPERATION_RECORD_SEND_TIMEOUT;
    loop {
        match sender.try_send(operation_record) {
            Ok(()) => return,
            Err(mpsc::error::TrySendError::Closed(_)) => {
                eprintln!("sandboxd dropped lifecycle operation record because stream is closed");
                return;
            }
            Err(mpsc::error::TrySendError::Full(returned_record)) => {
                if Instant::now() >= deadline {
                    eprintln!("sandboxd dropped lifecycle operation record after send timeout");
                    return;
                }
                operation_record = returned_record;
                std::thread::sleep(LIFECYCLE_OPERATION_RECORD_SEND_RETRY_INTERVAL);
            }
        }
    }
}

fn operation_record_line(
    operation: StartupOperation,
    observed_at: String,
    event: &str,
    payload: &Value,
) -> Result<Option<String>, String> {
    let record = if event == started_event_name(operation) {
        json!({
            "kind": "lifecycle",
            "observedAt": observed_at,
            "phase": "sandboxd",
            "status": "started",
            "source": "sandboxd",
            "message": format!("sandboxd {} started", operation.as_str()),
            "attributes": {}
        })
    } else if event == failed_event_name(operation) {
        json!({
            "kind": "lifecycle",
            "observedAt": observed_at,
            "phase": "sandboxd",
            "status": "failed",
            "source": "sandboxd",
            "message": format!("sandboxd {} failed", operation.as_str()),
            "attributes": lifecycle_attributes(payload)
        })
    } else if event == phase_started_event_name(operation) {
        let Some(phase) = payload.get("phase").and_then(Value::as_str) else {
            return Ok(None);
        };
        let phase = operation_lifecycle_phase(phase);
        json!({
            "kind": "lifecycle",
            "observedAt": observed_at,
            "phase": phase,
            "status": "started",
            "source": "sandboxd",
            "message": format!("{phase} started"),
            "attributes": lifecycle_attributes(payload)
        })
    } else if event == phase_completed_event_name(operation) {
        let Some(phase) = payload.get("phase").and_then(Value::as_str) else {
            return Ok(None);
        };
        let phase = operation_lifecycle_phase(phase);
        json!({
            "kind": "lifecycle",
            "observedAt": observed_at,
            "phase": phase,
            "status": "completed",
            "source": "sandboxd",
            "message": format!("{phase} completed"),
            "attributes": lifecycle_attributes(payload)
        })
    } else if event == phase_failed_event_name(operation) {
        let Some(phase) = payload.get("phase").and_then(Value::as_str) else {
            return Ok(None);
        };
        let phase = operation_lifecycle_phase(phase);
        json!({
            "kind": "lifecycle",
            "observedAt": observed_at,
            "phase": phase,
            "status": "failed",
            "source": "sandboxd",
            "message": format!("{phase} failed"),
            "attributes": lifecycle_attributes(payload)
        })
    } else if event == transcript_event_name(operation) {
        json!({
            "kind": "transcript",
            "observedAt": observed_at,
            "phase": payload
                .get("phase")
                .and_then(Value::as_str)
                .map(operation_lifecycle_phase),
            "source": "sandboxd",
            "stream": payload.get("stream").and_then(Value::as_str).unwrap_or("system"),
            "payloadBase64": payload
                .get("payloadBase64")
                .and_then(Value::as_str)
                .unwrap_or("")
        })
    } else {
        return Ok(None);
    };

    let mut line = serde_json::to_string(&record)
        .map_err(|error| format!("failed to serialize operation record: {error}"))?;
    line.push('\n');
    Ok(Some(line))
}

fn operation_lifecycle_phase(phase: &str) -> &'static str {
    match phase {
        "apply_git_identity" => "git_identity",
        "attach_runtime_agent_endpoint" => "agent_endpoint",
        "apply_runtime_plan" => "runtime_plan",
        "run_setup_script" => "setup_script",
        "start_egress_proxy" => "egress",
        "stop_egress_proxy" => "teardown",
        "start_runtime_adapters" => "runtime_adapters",
        "start_runtime_processes" => "runtime_processes",
        "start_tunnel_session" | "stop_tunnel_session" => "operation_stream",
        "wait_storage_attach" => "storage_attach",
        "ready" => "ready",
        _ => "sandboxd",
    }
}

fn lifecycle_attributes(payload: &Value) -> Value {
    let mut attributes = Map::new();
    if let Some(object) = payload.as_object() {
        for (key, value) in object {
            if matches!(
                key.as_str(),
                "timestamp" | "level" | "event" | "sandboxInstanceId" | "operation"
            ) {
                continue;
            }
            attributes.insert(key.clone(), value.clone());
        }
    }
    Value::Object(attributes)
}

fn started_event_name(operation: StartupOperation) -> &'static str {
    match operation {
        StartupOperation::Init => "sandbox_init_started",
        StartupOperation::Resume => "sandbox_resume_started",
    }
}

fn phase_failed_event_name(operation: StartupOperation) -> &'static str {
    match operation {
        StartupOperation::Init => "sandbox_init_phase_failed",
        StartupOperation::Resume => "sandbox_resume_phase_failed",
    }
}

fn phase_started_event_name(operation: StartupOperation) -> &'static str {
    match operation {
        StartupOperation::Init => "sandbox_init_phase_started",
        StartupOperation::Resume => "sandbox_resume_phase_started",
    }
}

fn phase_completed_event_name(operation: StartupOperation) -> &'static str {
    match operation {
        StartupOperation::Init => "sandbox_init_phase_completed",
        StartupOperation::Resume => "sandbox_resume_phase_completed",
    }
}

fn failed_event_name(operation: StartupOperation) -> &'static str {
    match operation {
        StartupOperation::Init => "sandbox_init_failed",
        StartupOperation::Resume => "sandbox_resume_failed",
    }
}

fn transcript_event_name(operation: StartupOperation) -> &'static str {
    match operation {
        StartupOperation::Init => "sandbox_init_transcript",
        StartupOperation::Resume => "sandbox_resume_transcript",
    }
}

fn operation_log_path(operation: StartupOperation) -> PathBuf {
    if let Some(test_dir) = test_log_dir_override() {
        return test_dir.join(match operation {
            StartupOperation::Init => "init.log",
            StartupOperation::Resume => "resume.log",
        });
    }

    PathBuf::from(operation.default_log_path())
}

fn test_log_dir_override() -> Option<PathBuf> {
    test_log_dir_override_lock();
    std::env::var_os(TEST_LOG_DIR_ENV).map(PathBuf::from)
}

fn test_log_dir_override_lock() -> &'static Mutex<()> {
    static LOCK: OnceLock<Mutex<()>> = OnceLock::new();
    LOCK.get_or_init(|| Mutex::new(()))
}

pub fn startup_diagnostics_string(value: impl Into<String>) -> Value {
    Value::String(value.into())
}

pub fn startup_diagnostics_u64(value: u64) -> Value {
    Value::Number(Number::from(value))
}

pub fn startup_diagnostics_u32(value: u32) -> Value {
    Value::Number(Number::from(value))
}

pub fn startup_diagnostics_bool(value: bool) -> Value {
    Value::Bool(value)
}

#[cfg(test)]
mod tests {
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
            record["event"] == "sandbox_init_phase_started"
                && record["phase"] == "apply_runtime_plan"
        }));
        assert!(records.iter().any(|record| {
            record["event"] == "sandbox_init_phase_completed"
                && record["phase"] == "apply_runtime_plan"
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
}
