use std::collections::BTreeMap;
use std::fs::{self, OpenOptions};
use std::io::Write;
use std::path::PathBuf;
use std::sync::{Mutex, OnceLock};

use serde_json::{Map, Number, Value};

use crate::time::{Clock, SystemClock, format_rfc3339_timestamp};
use crate::tunnel::session::derive_sandbox_instance_id;

pub const INIT_LOG_PATH: &str = "/run/mistle/init.log";
pub const RESUME_LOG_PATH: &str = "/run/mistle/resume.log";

const TEST_LOG_DIR_ENV: &str = "MISTLE_SANDBOXD_OPERATION_LOG_DIR";

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

#[derive(Debug, Clone)]
pub struct StartupDiagnosticsLogger {
    sandbox_instance_id: String,
    operation: StartupOperation,
    path: PathBuf,
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
            sandbox_instance_id,
            operation,
            path,
        })
    }

    pub fn record_started(&self) -> Result<(), String> {
        self.record_with_clock(
            &SystemClock,
            StartupDiagnosticLevel::Info,
            started_event_name(self.operation),
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
            phase_failed_event_name(self.operation),
            attributes,
        )
    }

    pub fn record_phase_started(&self, phase: &str) -> Result<(), String> {
        self.record_with_clock(
            &SystemClock,
            StartupDiagnosticLevel::Info,
            phase_started_event_name(self.operation),
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
            phase_completed_event_name(self.operation),
            attributes,
        )
    }

    pub fn record_failed(&self, mut attributes: BTreeMap<String, Value>) -> Result<(), String> {
        self.record_with_clock(
            &SystemClock,
            StartupDiagnosticLevel::Error,
            failed_event_name(self.operation),
            {
                attributes.remove("operation");
                attributes
            },
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
        payload.insert("timestamp".to_string(), Value::String(timestamp));
        payload.insert(
            "level".to_string(),
            Value::String(level.as_str().to_string()),
        );
        payload.insert("event".to_string(), Value::String(event.to_string()));
        payload.insert(
            "sandboxInstanceId".to_string(),
            Value::String(self.sandbox_instance_id.clone()),
        );
        payload.insert(
            "operation".to_string(),
            Value::String(self.operation.as_str().to_string()),
        );

        for (key, value) in attributes {
            payload.insert(key, value);
        }

        let mut line = serde_json::to_string(&Value::Object(payload))
            .map_err(|error| format!("failed to serialize startup diagnostic event: {error}"))?;
        line.push('\n');

        let mut file = OpenOptions::new()
            .create(true)
            .append(true)
            .open(&self.path)
            .map_err(|error| {
                format!(
                    "failed to open startup diagnostic log {} for append: {error}",
                    self.path.display()
                )
            })?;
        file.write_all(line.as_bytes()).map_err(|error| {
            format!(
                "failed to append startup diagnostic log {}: {error}",
                self.path.display()
            )
        })
    }
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
    use std::time::{Duration, UNIX_EPOCH};

    use serde_json::Value;

    use super::{INIT_LOG_PATH, RESUME_LOG_PATH, StartupDiagnosticsLogger, StartupOperation};
    use crate::test_support::TestEnvVarGuard;
    use crate::time::Clock;

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
            record["event"] == "sandbox_init_phase_failed"
                && record["phase"] == "apply_runtime_plan"
                && record["error"] == "workspace clone failed"
        }));

        let _ = fs::remove_dir_all(&temp_dir);
        assert_eq!(INIT_LOG_PATH, "/run/mistle/init.log");
        assert_eq!(RESUME_LOG_PATH, "/run/mistle/resume.log");
    }
}
