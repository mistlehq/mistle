//! Agent websocket stream state owned by the live tunnel session.

use std::collections::VecDeque;

use serde_json::Value;
use tokio::sync::mpsc;
use tokio_tungstenite::tungstenite::Message;

use crate::time::Clock;
use crate::tunnel::protocol::{
    AGENT_STREAM_WINDOW_BYTES, PAYLOAD_KIND_WEBSOCKET_BINARY, PAYLOAD_KIND_WEBSOCKET_TEXT,
    StreamSendWindow,
};
use crate::tunnel::session::{
    TunnelSessionMutableState, TunnelWriterMessage, publish_tunnel_telemetry_log,
};
use crate::tunnel::telemetry::{SandboxTelemetryLogLevel, TelemetryRelay};

pub(super) const AGENT_STREAM_OUTCOME_CLOSED: &str = "closed";
pub(super) const AGENT_STREAM_OUTCOME_RESET: &str = "reset";
pub(super) const AGENT_STREAM_CLOSE_SOURCE_GATEWAY: &str = "gateway";
pub(super) const AGENT_STREAM_CLOSE_SOURCE_RUNTIME: &str = "runtime";

const AGENT_STREAM_WINDOW_THRESHOLD_BYTES: [usize; 5] = [
    1024 * 1024,
    2 * 1024 * 1024,
    4 * 1024 * 1024,
    8 * 1024 * 1024,
    AGENT_STREAM_WINDOW_BYTES.saturating_mul(95) / 100,
];
const AGENT_STREAM_CHANNEL_KIND: &str = "agent";
const AGENT_STREAM_EVENT_SUMMARY: &str = "agent_stream_summary";
const AGENT_STREAM_EVENT_WINDOW_EXHAUSTED: &str = "agent_stream_window_exhausted";
const AGENT_STREAM_EVENT_WINDOW_THRESHOLD_CROSSED: &str = "agent_stream_window_threshold_crossed";
const AGENT_STREAM_OUTCOME_BOOTSTRAP_CLOSED: &str = "bootstrap_closed";
const AGENT_STREAM_CLOSE_SOURCE_BOOTSTRAP: &str = "bootstrap";

#[derive(Debug, Clone, Copy)]
struct OutstandingAgentSend {
    bytes: usize,
    sent_at_ms: u64,
}

#[derive(Debug)]
pub(super) struct AgentStreamStats {
    opened_at_ms: u64,
    pub(super) message_count_out: u64,
    message_count_in: u64,
    total_bytes_out: u64,
    total_bytes_in: u64,
    max_message_bytes_out: usize,
    max_message_bytes_in: usize,
    max_outstanding_bytes: usize,
    credit_return_count: u64,
    credit_return_total_ms: u64,
    threshold_emissions_mask: u8,
    outstanding_sends: VecDeque<OutstandingAgentSend>,
}

impl AgentStreamStats {
    pub(super) fn new(opened_at_ms: u64) -> Self {
        Self {
            opened_at_ms,
            message_count_out: 0,
            message_count_in: 0,
            total_bytes_out: 0,
            total_bytes_in: 0,
            max_message_bytes_out: 0,
            max_message_bytes_in: 0,
            max_outstanding_bytes: 0,
            credit_return_count: 0,
            credit_return_total_ms: 0,
            threshold_emissions_mask: 0,
            outstanding_sends: VecDeque::new(),
        }
    }

    pub(super) fn record_outbound_message(
        &mut self,
        payload_bytes: usize,
        sent_at_ms: u64,
        outstanding_bytes: usize,
    ) {
        self.message_count_out = self.message_count_out.saturating_add(1);
        self.total_bytes_out = self.total_bytes_out.saturating_add(payload_bytes as u64);
        self.max_message_bytes_out = self.max_message_bytes_out.max(payload_bytes);
        self.max_outstanding_bytes = self.max_outstanding_bytes.max(outstanding_bytes);
        self.outstanding_sends.push_back(OutstandingAgentSend {
            bytes: payload_bytes,
            sent_at_ms,
        });
    }

    pub(super) fn record_inbound_message(&mut self, payload_bytes: usize) {
        self.message_count_in = self.message_count_in.saturating_add(1);
        self.total_bytes_in = self.total_bytes_in.saturating_add(payload_bytes as u64);
        self.max_message_bytes_in = self.max_message_bytes_in.max(payload_bytes);
    }

    pub(super) fn record_credit_restore(&mut self, bytes: usize, restored_at_ms: u64) {
        let mut remaining_bytes = bytes;
        while remaining_bytes > 0 {
            let Some(front_send) = self.outstanding_sends.front_mut() else {
                return;
            };
            let acknowledged_bytes = remaining_bytes.min(front_send.bytes);
            front_send.bytes -= acknowledged_bytes;
            remaining_bytes -= acknowledged_bytes;
            self.credit_return_count = self.credit_return_count.saturating_add(1);
            self.credit_return_total_ms = self
                .credit_return_total_ms
                .saturating_add(restored_at_ms.saturating_sub(front_send.sent_at_ms));
            if front_send.bytes == 0 {
                self.outstanding_sends.pop_front();
            }
        }
    }

    fn avg_credit_return_ms(&self) -> Option<u64> {
        if self.credit_return_count == 0 {
            return None;
        }

        Some(self.credit_return_total_ms / self.credit_return_count)
    }

    pub(super) fn stream_age_ms(&self, now_ms: u64) -> u64 {
        now_ms.saturating_sub(self.opened_at_ms)
    }

    pub(super) fn oldest_unacked_age_ms(&self, now_ms: u64) -> Option<u64> {
        self.outstanding_sends
            .front()
            .map(|send| now_ms.saturating_sub(send.sent_at_ms))
    }

    pub(super) fn take_new_threshold_crossings(&mut self, outstanding_bytes: usize) -> Vec<usize> {
        let mut crossed_thresholds = Vec::new();
        for (index, threshold_bytes) in AGENT_STREAM_WINDOW_THRESHOLD_BYTES.iter().enumerate() {
            let emission_bit = 1_u8 << index;
            if outstanding_bytes >= *threshold_bytes
                && self.threshold_emissions_mask & emission_bit == 0
            {
                self.threshold_emissions_mask |= emission_bit;
                crossed_thresholds.push(*threshold_bytes);
            }
        }
        crossed_thresholds
    }
}

pub(super) struct AgentStreamState {
    pub(super) sender: mpsc::UnboundedSender<Message>,
    pub(super) send_window: StreamSendWindow,
    pub(super) stats: AgentStreamStats,
}

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

pub(super) fn agent_stream_outstanding_bytes(send_window: &StreamSendWindow) -> usize {
    AGENT_STREAM_WINDOW_BYTES.saturating_sub(send_window.available_bytes())
}

pub(super) fn websocket_payload_kind_name(payload_kind: u8) -> &'static str {
    match payload_kind {
        PAYLOAD_KIND_WEBSOCKET_TEXT => "websocket_text",
        PAYLOAD_KIND_WEBSOCKET_BINARY => "websocket_binary",
        _ => "unknown",
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
