//! Startup diagnostics logging for long-running sandbox initialization.
//!
//! Diagnostics records are emitted alongside transcripts so control clients and
//! operators can inspect where initialization is spending time or failing.

use std::collections::BTreeMap;
use std::fs::{self, OpenOptions};
use std::io::Write;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use std::time::Duration;

use base64::Engine;
use base64::engine::general_purpose::STANDARD as Base64Standard;
use serde_json::{Map, Number, Value};
use tokio::sync::mpsc;

use crate::time::{Clock, SystemClock, format_rfc3339_timestamp};
use crate::tunnel::session::{OperationStreamMessage, derive_sandbox_instance_id};

mod operation_records;
mod paths;

use operation_records::*;
use paths::*;

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
    operation_publisher: Mutex<OperationPublisherState>,
}

struct OperationPublisherState {
    sender: Option<mpsc::Sender<OperationStreamMessage>>,
    pending_records: Vec<PendingOperationRecord>,
}

struct PendingOperationRecord {
    event: String,
    operation_record: String,
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
                operation_publisher: Mutex::new(OperationPublisherState {
                    sender: None,
                    pending_records: Vec::new(),
                }),
            }),
        })
    }

    pub fn attach_operation_sender(&self, sender: mpsc::Sender<OperationStreamMessage>) {
        let pending_records = {
            let mut operation_publisher = self
                .inner
                .operation_publisher
                .lock()
                .expect("startup diagnostics operation publisher lock should not be poisoned");
            operation_publisher.sender = Some(sender.clone());
            std::mem::take(&mut operation_publisher.pending_records)
        };

        for pending_record in pending_records {
            Self::send_operation_record(
                self.inner.operation,
                &pending_record.event,
                sender.clone(),
                pending_record.operation_record,
            );
        }
    }

    pub fn close_operation_stream(&self) {
        let sender = {
            let mut operation_publisher = self
                .inner
                .operation_publisher
                .lock()
                .expect("startup diagnostics operation publisher lock should not be poisoned");
            operation_publisher.pending_records.clear();
            operation_publisher.sender.take()
        };
        if let Some(sender) = sender {
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
        self.record_phase_started_with_attributes(phase, BTreeMap::new())
    }

    pub fn record_phase_started_with_attributes(
        &self,
        phase: &str,
        mut attributes: BTreeMap<String, Value>,
    ) -> Result<(), String> {
        attributes.insert("phase".to_string(), Value::String(phase.to_string()));
        self.record_with_clock(
            &SystemClock,
            StartupDiagnosticLevel::Info,
            phase_started_event_name(self.inner.operation),
            attributes,
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
        let sender = {
            let mut operation_publisher = self
                .inner
                .operation_publisher
                .lock()
                .expect("startup diagnostics operation publisher lock should not be poisoned");
            let Some(sender) = operation_publisher.sender.clone() else {
                operation_publisher
                    .pending_records
                    .push(PendingOperationRecord {
                        event: event.to_string(),
                        operation_record,
                    });
                return;
            };
            sender
        };

        Self::send_operation_record(self.inner.operation, event, sender, operation_record);
    }

    fn send_operation_record(
        operation: StartupOperation,
        event: &str,
        sender: mpsc::Sender<OperationStreamMessage>,
        operation_record: String,
    ) {
        let operation_record = OperationStreamMessage::Record(operation_record);
        if event == transcript_event_name(operation) {
            if let Err(error) = sender.try_send(operation_record) {
                eprintln!("sandboxd dropped operation transcript record: {error}");
            }
            return;
        }

        send_lifecycle_operation_record_with_timeout(sender, operation_record);
    }
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
mod tests;
