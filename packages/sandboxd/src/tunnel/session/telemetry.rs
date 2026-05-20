//! Telemetry publishing helpers for the live tunnel session.

use serde_json::Value;
use tokio::sync::mpsc;

use crate::time::Clock;
use crate::tunnel::protocol::AGENT_STREAM_WINDOW_BYTES;
use crate::tunnel::session::agent::AgentStreamState;
use crate::tunnel::session::bootstrap::{TunnelWriterMessage, send_telemetry_frames};
use crate::tunnel::session::state::TunnelSessionMutableState;
use crate::tunnel::telemetry::{SandboxTelemetryLogLevel, TelemetryRelay};

pub(super) const AGENT_STREAM_OUTCOME_CLOSED: &str = "closed";
pub(super) const AGENT_STREAM_OUTCOME_RESET: &str = "reset";
pub(super) const AGENT_STREAM_CLOSE_SOURCE_GATEWAY: &str = "gateway";
pub(super) const AGENT_STREAM_CLOSE_SOURCE_RUNTIME: &str = "runtime";

const AGENT_STREAM_CHANNEL_KIND: &str = "agent";
const AGENT_STREAM_EVENT_SUMMARY: &str = "agent_stream_summary";
const AGENT_STREAM_EVENT_WINDOW_EXHAUSTED: &str = "agent_stream_window_exhausted";
const AGENT_STREAM_EVENT_WINDOW_THRESHOLD_CROSSED: &str = "agent_stream_window_threshold_crossed";
const AGENT_STREAM_OUTCOME_BOOTSTRAP_CLOSED: &str = "bootstrap_closed";
const AGENT_STREAM_CLOSE_SOURCE_BOOTSTRAP: &str = "bootstrap";

pub(super) struct AgentStreamTermination {
    pub(super) outcome: &'static str,
    pub(super) close_source: &'static str,
    pub(super) reset_code: Option<&'static str>,
    pub(super) reason: Option<String>,
}

pub(super) struct AgentStreamWindowExhaustedTelemetry {
    pub(super) available_bytes: usize,
    pub(super) message_count_out: u64,
    pub(super) oldest_unacked_ms: Option<u64>,
    pub(super) outstanding_bytes: usize,
    pub(super) payload_bytes: usize,
    pub(super) payload_kind: &'static str,
    pub(super) stream_age_ms: u64,
    pub(super) stream_id: u32,
}

pub(super) struct AgentStreamThresholdTelemetry {
    pub(super) available_bytes: usize,
    pub(super) message_count_out: u64,
    pub(super) oldest_unacked_ms: Option<u64>,
    pub(super) outstanding_bytes: usize,
    pub(super) payload_bytes: usize,
    pub(super) payload_kind: &'static str,
    pub(super) stream_age_ms: u64,
    pub(super) stream_id: u32,
    pub(super) threshold_bytes: usize,
}

pub(super) fn publish_tunnel_telemetry_log(
    tunnel_writer_sender: &mpsc::UnboundedSender<TunnelWriterMessage>,
    telemetry_relay: &mut TelemetryRelay,
    clock: &dyn Clock,
    level: SandboxTelemetryLogLevel,
    event: &str,
    extra_fields: &[(&str, Value)],
) {
    match telemetry_relay.enqueue_log_record(clock, level, event, extra_fields) {
        Ok(frames) => {
            if let Err(error) = send_telemetry_frames(tunnel_writer_sender, frames) {
                eprintln!("sandboxd failed to publish telemetry event '{event}': {error}");
            }
        }
        Err(error) => {
            eprintln!("sandboxd failed to queue telemetry event '{event}': {error}");
        }
    }
}

fn publish_agent_stream_summary(
    tunnel_writer_sender: &mpsc::UnboundedSender<TunnelWriterMessage>,
    telemetry_relay: &mut TelemetryRelay,
    clock: &dyn Clock,
    stream_id: u32,
    agent_stream: &AgentStreamState,
    termination: &AgentStreamTermination,
) {
    let now_ms = clock.now_ms();
    let extra_fields = vec![
        ("streamId", Value::from(u64::from(stream_id))),
        (
            "channelKind",
            Value::String(AGENT_STREAM_CHANNEL_KIND.to_string()),
        ),
        ("outcome", Value::String(termination.outcome.to_string())),
        (
            "closeSource",
            Value::String(termination.close_source.to_string()),
        ),
        (
            "durationMs",
            Value::from(agent_stream.stats.stream_age_ms(now_ms)),
        ),
        (
            "messageCountOut",
            Value::from(agent_stream.stats.message_count_out),
        ),
        (
            "messageCountIn",
            Value::from(agent_stream.stats.message_count_in),
        ),
        (
            "totalBytesOut",
            Value::from(agent_stream.stats.total_bytes_out),
        ),
        (
            "totalBytesIn",
            Value::from(agent_stream.stats.total_bytes_in),
        ),
        (
            "maxMessageBytesOut",
            Value::from(agent_stream.stats.max_message_bytes_out as u64),
        ),
        (
            "maxMessageBytesIn",
            Value::from(agent_stream.stats.max_message_bytes_in as u64),
        ),
        (
            "maxOutstandingBytes",
            Value::from(agent_stream.stats.max_outstanding_bytes as u64),
        ),
        (
            "avgCreditReturnMs",
            agent_stream
                .stats
                .avg_credit_return_ms()
                .map_or(Value::Null, Value::from),
        ),
        (
            "creditReturnCount",
            Value::from(agent_stream.stats.credit_return_count),
        ),
        (
            "resetCode",
            termination
                .reset_code
                .map(|reset_code| Value::String(reset_code.to_string()))
                .unwrap_or(Value::Null),
        ),
        (
            "reason",
            termination
                .reason
                .as_ref()
                .map(|reason| Value::String(reason.clone()))
                .unwrap_or(Value::Null),
        ),
    ];

    publish_tunnel_telemetry_log(
        tunnel_writer_sender,
        telemetry_relay,
        clock,
        SandboxTelemetryLogLevel::Info,
        AGENT_STREAM_EVENT_SUMMARY,
        &extra_fields,
    );
}

pub(super) fn remove_agent_stream_and_publish_summary(
    tunnel_writer_sender: &mpsc::UnboundedSender<TunnelWriterMessage>,
    session_state: &mut TunnelSessionMutableState,
    clock: &dyn Clock,
    stream_id: u32,
    termination: AgentStreamTermination,
) -> Option<AgentStreamState> {
    let agent_stream = session_state.agent_streams.remove(&stream_id)?;
    publish_agent_stream_summary(
        tunnel_writer_sender,
        &mut session_state.telemetry_relay,
        clock,
        stream_id,
        &agent_stream,
        &termination,
    );
    Some(agent_stream)
}

pub(super) fn publish_agent_stream_window_exhausted(
    tunnel_writer_sender: &mpsc::UnboundedSender<TunnelWriterMessage>,
    telemetry_relay: &mut TelemetryRelay,
    clock: &dyn Clock,
    telemetry: AgentStreamWindowExhaustedTelemetry,
) {
    let extra_fields = vec![
        ("streamId", Value::from(u64::from(telemetry.stream_id))),
        (
            "channelKind",
            Value::String(AGENT_STREAM_CHANNEL_KIND.to_string()),
        ),
        (
            "payloadKind",
            Value::String(telemetry.payload_kind.to_string()),
        ),
        ("payloadBytes", Value::from(telemetry.payload_bytes as u64)),
        (
            "availableBytes",
            Value::from(telemetry.available_bytes as u64),
        ),
        (
            "outstandingBytes",
            Value::from(telemetry.outstanding_bytes as u64),
        ),
        (
            "maxWindowBytes",
            Value::from(AGENT_STREAM_WINDOW_BYTES as u64),
        ),
        (
            "payloadExceedsMaxWindow",
            Value::Bool(telemetry.payload_bytes > AGENT_STREAM_WINDOW_BYTES),
        ),
        (
            "payloadExceedsAvailableWindow",
            Value::Bool(telemetry.payload_bytes > telemetry.available_bytes),
        ),
        ("messageCountOut", Value::from(telemetry.message_count_out)),
        ("streamAgeMs", Value::from(telemetry.stream_age_ms)),
        (
            "oldestUnackedMs",
            telemetry.oldest_unacked_ms.map_or(Value::Null, Value::from),
        ),
    ];

    publish_tunnel_telemetry_log(
        tunnel_writer_sender,
        telemetry_relay,
        clock,
        SandboxTelemetryLogLevel::Warn,
        AGENT_STREAM_EVENT_WINDOW_EXHAUSTED,
        &extra_fields,
    );
}

pub(super) fn publish_agent_stream_threshold_crossed(
    tunnel_writer_sender: &mpsc::UnboundedSender<TunnelWriterMessage>,
    telemetry_relay: &mut TelemetryRelay,
    clock: &dyn Clock,
    telemetry: AgentStreamThresholdTelemetry,
) {
    let extra_fields = vec![
        ("streamId", Value::from(u64::from(telemetry.stream_id))),
        (
            "channelKind",
            Value::String(AGENT_STREAM_CHANNEL_KIND.to_string()),
        ),
        (
            "payloadKind",
            Value::String(telemetry.payload_kind.to_string()),
        ),
        ("payloadBytes", Value::from(telemetry.payload_bytes as u64)),
        (
            "availableBytes",
            Value::from(telemetry.available_bytes as u64),
        ),
        (
            "outstandingBytes",
            Value::from(telemetry.outstanding_bytes as u64),
        ),
        (
            "thresholdBytes",
            Value::from(telemetry.threshold_bytes as u64),
        ),
        (
            "maxWindowBytes",
            Value::from(AGENT_STREAM_WINDOW_BYTES as u64),
        ),
        ("messageCountOut", Value::from(telemetry.message_count_out)),
        ("streamAgeMs", Value::from(telemetry.stream_age_ms)),
        (
            "oldestUnackedMs",
            telemetry.oldest_unacked_ms.map_or(Value::Null, Value::from),
        ),
    ];

    publish_tunnel_telemetry_log(
        tunnel_writer_sender,
        telemetry_relay,
        clock,
        SandboxTelemetryLogLevel::Warn,
        AGENT_STREAM_EVENT_WINDOW_THRESHOLD_CROSSED,
        &extra_fields,
    );
}

pub(super) fn publish_bootstrap_closed_agent_stream_summaries(
    tunnel_writer_sender: &mpsc::UnboundedSender<TunnelWriterMessage>,
    session_state: &mut TunnelSessionMutableState,
    clock: &dyn Clock,
    reason: &str,
) {
    let drained_streams = std::mem::take(&mut session_state.agent_streams);
    for (stream_id, agent_stream) in drained_streams {
        publish_agent_stream_summary(
            tunnel_writer_sender,
            &mut session_state.telemetry_relay,
            clock,
            stream_id,
            &agent_stream,
            &AgentStreamTermination {
                outcome: AGENT_STREAM_OUTCOME_BOOTSTRAP_CLOSED,
                close_source: AGENT_STREAM_CLOSE_SOURCE_BOOTSTRAP,
                reset_code: None,
                reason: Some(reason.to_string()),
            },
        );
    }
}
