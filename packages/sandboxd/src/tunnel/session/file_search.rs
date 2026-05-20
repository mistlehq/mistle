//! File-search stream state and telemetry owned by the live tunnel session.

use serde_json::Value;
use tokio::sync::mpsc;

use crate::time::Clock;
use crate::tunnel::file_search::{
    FileSearchQueryMetrics, FileSearchWorker, FileSearchWorkerCommand, FileSearchWorkerEvent,
};
use crate::tunnel::protocol::{
    FileSearchError, FileSearchResults, PAYLOAD_KIND_WEBSOCKET_TEXT,
    STREAM_RESET_CODE_STREAM_WINDOW_EXHAUSTED, STREAM_RESET_CODE_TARGET_CLOSED, StreamSendWindow,
    encode_stream_data_frame, stream_reset,
};
use crate::tunnel::session::TunnelSessionError;
use crate::tunnel::session::bootstrap::{
    TunnelWriterMessage, write_tunnel_binary, write_tunnel_text,
};
use crate::tunnel::session::state::TunnelSessionMutableState;
use crate::tunnel::session::telemetry::publish_tunnel_telemetry_log;
use crate::tunnel::telemetry::{SandboxTelemetryLogLevel, TelemetryRelay};

pub(super) const FILE_SEARCH_STREAM_CHANNEL_KIND: &str = "fileSearch";
pub(super) const FILE_SEARCH_EVENT_STREAM_OPENED: &str = "file_search_stream_opened";
const FILE_SEARCH_EVENT_STREAM_SUMMARY: &str = "file_search_stream_summary";
const FILE_SEARCH_EVENT_QUERY_COMPLETED: &str = "file_search_query_completed";
const FILE_SEARCH_EVENT_QUERY_FAILED: &str = "file_search_query_failed";
pub(super) const FILE_SEARCH_OUTCOME_CLOSED: &str = "closed";
pub(super) const FILE_SEARCH_OUTCOME_RESET: &str = "reset";
pub(super) const FILE_SEARCH_CLOSE_SOURCE_GATEWAY: &str = "gateway";
pub(super) const FILE_SEARCH_CLOSE_SOURCE_SANDBOXD: &str = "sandboxd";

pub(super) struct FileSearchStreamCloseTelemetry {
    pub(super) outcome: &'static str,
    pub(super) close_source: &'static str,
    pub(super) reason: Option<String>,
}

pub(super) struct FileSearchStreamState {
    worker: FileSearchWorker,
    pub(super) send_window: StreamSendWindow,
    opened_at_ms: u64,
    query_count: u64,
    error_count: u64,
    total_result_count: u64,
    collapsed_query_count: u64,
    total_latency_ms: u64,
    max_latency_ms: u64,
}

impl FileSearchStreamState {
    pub(super) fn new(worker: FileSearchWorker, opened_at_ms: u64) -> Self {
        Self {
            worker,
            send_window: StreamSendWindow::default(),
            opened_at_ms,
            query_count: 0,
            error_count: 0,
            total_result_count: 0,
            collapsed_query_count: 0,
            total_latency_ms: 0,
            max_latency_ms: 0,
        }
    }
}

pub(super) fn handle_file_search_worker_event(
    tunnel_writer_sender: &mpsc::UnboundedSender<TunnelWriterMessage>,
    event: FileSearchWorkerEvent,
    clock: &dyn Clock,
    session_state: &mut TunnelSessionMutableState,
) -> Result<(), TunnelSessionError> {
    let (stream_id, telemetry_event, telemetry_level, telemetry_fields, metrics, is_error, payload) =
        match event {
            FileSearchWorkerEvent::Results {
                stream_id,
                request_id,
                query,
                items,
                metrics,
            } => {
                let payload = serde_json::to_string(&FileSearchResults {
                    message_type: "fileSearch.results".to_string(),
                    request_id: request_id.clone(),
                    query: query.clone(),
                    items,
                })
                .map_err(|error| TunnelSessionError::ParseDataFrame(error.to_string()))?;
                (
                    stream_id,
                    FILE_SEARCH_EVENT_QUERY_COMPLETED,
                    SandboxTelemetryLogLevel::Info,
                    file_search_query_telemetry_fields(stream_id, &request_id, &metrics),
                    metrics,
                    false,
                    payload,
                )
            }
            FileSearchWorkerEvent::Error {
                stream_id,
                request_id,
                code,
                message,
                metrics,
            } => {
                let payload = serde_json::to_string(&FileSearchError {
                    message_type: "fileSearch.error".to_string(),
                    request_id: request_id.clone(),
                    code: code.clone(),
                    message: message.clone(),
                })
                .map_err(|error| TunnelSessionError::ParseDataFrame(error.to_string()))?;
                let mut fields =
                    file_search_query_telemetry_fields(stream_id, &request_id, &metrics);
                fields.push(("code", Value::String(code)));
                fields.push(("error", Value::String(message)));
                (
                    stream_id,
                    FILE_SEARCH_EVENT_QUERY_FAILED,
                    SandboxTelemetryLogLevel::Warn,
                    fields,
                    metrics,
                    true,
                    payload,
                )
            }
        };

    {
        let Some(stream_state) = session_state.file_search_streams.get_mut(&stream_id) else {
            return Ok(());
        };
        record_file_search_query_metrics(stream_state, &metrics, is_error);
    }
    publish_tunnel_telemetry_log(
        tunnel_writer_sender,
        &mut session_state.telemetry_relay,
        clock,
        telemetry_level,
        telemetry_event,
        &telemetry_fields,
    );
    let Some(stream_state) = session_state.file_search_streams.get_mut(&stream_id) else {
        return Ok(());
    };
    if !stream_state.send_window.try_consume(payload.len()) {
        write_tunnel_text(
            tunnel_writer_sender,
            stream_reset(
                stream_id,
                STREAM_RESET_CODE_STREAM_WINDOW_EXHAUSTED,
                "file search stream send window is exhausted",
            ),
        )?;
        close_file_search_stream(
            tunnel_writer_sender,
            session_state,
            clock,
            stream_id,
            FileSearchStreamCloseTelemetry {
                outcome: FILE_SEARCH_OUTCOME_RESET,
                close_source: FILE_SEARCH_CLOSE_SOURCE_SANDBOXD,
                reason: Some("file search stream send window is exhausted".to_string()),
            },
        );
        return Ok(());
    }

    let encoded =
        encode_stream_data_frame(stream_id, PAYLOAD_KIND_WEBSOCKET_TEXT, payload.as_bytes())
            .map_err(|error| TunnelSessionError::ParseDataFrame(error.to_string()))?;
    write_tunnel_binary(tunnel_writer_sender, encoded)?;
    Ok(())
}

pub(super) fn close_file_search_stream(
    tunnel_writer_sender: &mpsc::UnboundedSender<TunnelWriterMessage>,
    session_state: &mut TunnelSessionMutableState,
    clock: &dyn Clock,
    stream_id: u32,
    close_telemetry: FileSearchStreamCloseTelemetry,
) {
    if let Some(stream_state) = session_state.file_search_streams.remove(&stream_id) {
        publish_file_search_stream_summary(
            tunnel_writer_sender,
            &mut session_state.telemetry_relay,
            clock,
            stream_id,
            &stream_state,
            close_telemetry,
        );
        close_file_search_worker(stream_state);
    }
}

#[cfg(test)]
pub(super) fn terminate_file_search_stream(
    session_state: &mut TunnelSessionMutableState,
    stream_id: u32,
) {
    if let Some(stream_state) = session_state.file_search_streams.remove(&stream_id) {
        close_file_search_worker(stream_state);
    }
}

pub(super) fn file_search_query_telemetry_fields(
    stream_id: u32,
    request_id: &str,
    metrics: &FileSearchQueryMetrics,
) -> Vec<(&'static str, Value)> {
    let requested_limit = metrics
        .requested_limit
        .map(|limit| Value::from(limit as u64))
        .unwrap_or(Value::Null);

    vec![
        ("streamId", Value::from(u64::from(stream_id))),
        (
            "channelKind",
            Value::String(FILE_SEARCH_STREAM_CHANNEL_KIND.to_string()),
        ),
        ("requestId", Value::String(request_id.to_string())),
        ("queryLength", Value::from(metrics.query_length as u64)),
        ("requestedLimit", requested_limit),
        (
            "effectiveLimit",
            Value::from(metrics.effective_limit as u64),
        ),
        (
            "collapsedQueryCount",
            Value::from(metrics.collapsed_query_count),
        ),
        ("debounceWaitMs", Value::from(metrics.debounce_wait_ms)),
        ("scanWaitMs", Value::from(metrics.scan_wait_ms)),
        ("searchMs", Value::from(metrics.search_ms)),
        ("latencyMs", Value::from(metrics.total_latency_ms)),
        ("resultCount", Value::from(metrics.result_count as u64)),
        ("limited", Value::Bool(metrics.limited)),
    ]
}

fn record_file_search_query_metrics(
    stream_state: &mut FileSearchStreamState,
    metrics: &FileSearchQueryMetrics,
    is_error: bool,
) {
    stream_state.query_count = stream_state.query_count.saturating_add(1);
    if is_error {
        stream_state.error_count = stream_state.error_count.saturating_add(1);
    }
    stream_state.total_result_count = stream_state
        .total_result_count
        .saturating_add(metrics.result_count as u64);
    stream_state.collapsed_query_count = stream_state
        .collapsed_query_count
        .saturating_add(metrics.collapsed_query_count);
    stream_state.total_latency_ms = stream_state
        .total_latency_ms
        .saturating_add(metrics.total_latency_ms);
    stream_state.max_latency_ms = stream_state.max_latency_ms.max(metrics.total_latency_ms);
}

fn publish_file_search_stream_summary(
    tunnel_writer_sender: &mpsc::UnboundedSender<TunnelWriterMessage>,
    telemetry_relay: &mut TelemetryRelay,
    clock: &dyn Clock,
    stream_id: u32,
    stream_state: &FileSearchStreamState,
    close_telemetry: FileSearchStreamCloseTelemetry,
) {
    let mut fields = vec![
        ("streamId", Value::from(u64::from(stream_id))),
        (
            "channelKind",
            Value::String(FILE_SEARCH_STREAM_CHANNEL_KIND.to_string()),
        ),
        (
            "outcome",
            Value::String(close_telemetry.outcome.to_string()),
        ),
        (
            "closeSource",
            Value::String(close_telemetry.close_source.to_string()),
        ),
        (
            "durationMs",
            Value::from(clock.now_ms().saturating_sub(stream_state.opened_at_ms)),
        ),
        ("queryCount", Value::from(stream_state.query_count)),
        ("errorCount", Value::from(stream_state.error_count)),
        (
            "totalResultCount",
            Value::from(stream_state.total_result_count),
        ),
        (
            "collapsedQueryCount",
            Value::from(stream_state.collapsed_query_count),
        ),
        ("totalLatencyMs", Value::from(stream_state.total_latency_ms)),
        ("maxLatencyMs", Value::from(stream_state.max_latency_ms)),
    ];
    if let Some(reason) = close_telemetry.reason {
        fields.push(("reason", Value::String(reason)));
    }

    publish_tunnel_telemetry_log(
        tunnel_writer_sender,
        telemetry_relay,
        clock,
        SandboxTelemetryLogLevel::Info,
        FILE_SEARCH_EVENT_STREAM_SUMMARY,
        &fields,
    );
}

pub(super) fn send_file_search_command(
    tunnel_writer_sender: &mpsc::UnboundedSender<TunnelWriterMessage>,
    session_state: &mut TunnelSessionMutableState,
    clock: &dyn Clock,
    stream_id: u32,
    command: FileSearchWorkerCommand,
) -> Result<(), TunnelSessionError> {
    let Some(stream_state) = session_state.file_search_streams.get(&stream_id) else {
        return Ok(());
    };

    if stream_state.worker.command_sender.send(command).is_err() {
        write_tunnel_text(
            tunnel_writer_sender,
            stream_reset(
                stream_id,
                STREAM_RESET_CODE_TARGET_CLOSED,
                "file search worker closed",
            ),
        )?;
        close_file_search_stream(
            tunnel_writer_sender,
            session_state,
            clock,
            stream_id,
            FileSearchStreamCloseTelemetry {
                outcome: FILE_SEARCH_OUTCOME_RESET,
                close_source: FILE_SEARCH_CLOSE_SOURCE_SANDBOXD,
                reason: Some("file search worker closed".to_string()),
            },
        );
    }

    Ok(())
}

fn close_file_search_worker(stream_state: FileSearchStreamState) {
    let _ = stream_state
        .worker
        .command_sender
        .send(FileSearchWorkerCommand::Close);
}
