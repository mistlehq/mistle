//! Agent websocket stream state owned by the live tunnel session.

use std::collections::VecDeque;

use tokio::sync::mpsc;
use tokio_tungstenite::tungstenite::Message;

use crate::time::Clock;
use crate::tunnel::protocol::{
    AGENT_STREAM_WINDOW_BYTES, PAYLOAD_KIND_WEBSOCKET_BINARY, PAYLOAD_KIND_WEBSOCKET_TEXT,
    STREAM_RESET_CODE_INVALID_STREAM_DATA, STREAM_RESET_CODE_STREAM_WINDOW_EXHAUSTED,
    STREAM_RESET_CODE_TARGET_CLOSED, StreamDataFrame, StreamSendWindow, encode_stream_data_frame,
    stream_reset,
};
use crate::tunnel::session::telemetry::{
    AGENT_STREAM_CLOSE_SOURCE_GATEWAY, AGENT_STREAM_CLOSE_SOURCE_RUNTIME,
    AGENT_STREAM_OUTCOME_RESET, AgentStreamTermination, AgentStreamThresholdTelemetry,
    AgentStreamWindowExhaustedTelemetry, publish_agent_stream_threshold_crossed,
    publish_agent_stream_window_exhausted, remove_agent_stream_and_publish_summary,
};
use crate::tunnel::session::{
    TunnelSessionError, TunnelSessionMutableState, TunnelWriterMessage, write_tunnel_binary,
    write_tunnel_text,
};

const AGENT_STREAM_WINDOW_THRESHOLD_BYTES: [usize; 5] = [
    1024 * 1024,
    2 * 1024 * 1024,
    4 * 1024 * 1024,
    8 * 1024 * 1024,
    AGENT_STREAM_WINDOW_BYTES.saturating_mul(95) / 100,
];

#[derive(Debug, Clone, Copy)]
struct OutstandingAgentSend {
    bytes: usize,
    sent_at_ms: u64,
}

#[derive(Debug)]
pub(super) struct AgentStreamStats {
    opened_at_ms: u64,
    pub(super) message_count_out: u64,
    pub(super) message_count_in: u64,
    pub(super) total_bytes_out: u64,
    pub(super) total_bytes_in: u64,
    pub(super) max_message_bytes_out: usize,
    pub(super) max_message_bytes_in: usize,
    pub(super) max_outstanding_bytes: usize,
    pub(super) credit_return_count: u64,
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

    pub(super) fn avg_credit_return_ms(&self) -> Option<u64> {
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

struct AgentOutboundTelemetry {
    available_bytes: usize,
    outstanding_bytes: usize,
    message_count_out: u64,
    stream_age_ms: u64,
    oldest_unacked_ms: Option<u64>,
}

struct AgentOutboundAccepted {
    telemetry: AgentOutboundTelemetry,
    threshold_crossings: Vec<usize>,
}

pub(super) fn create_agent_stream(
    sender: mpsc::UnboundedSender<Message>,
    opened_at_ms: u64,
) -> AgentStreamState {
    AgentStreamState {
        sender,
        send_window: StreamSendWindow::new(AGENT_STREAM_WINDOW_BYTES),
        stats: AgentStreamStats::new(opened_at_ms),
    }
}

pub(super) fn add_agent_stream_window_credit(
    session_state: &mut TunnelSessionMutableState,
    stream_id: u32,
    bytes: usize,
    restored_at_ms: u64,
) -> Result<bool, TunnelSessionError> {
    let Some(agent_stream) = session_state.agent_streams.get_mut(&stream_id) else {
        return Ok(false);
    };

    agent_stream
        .send_window
        .add(bytes)
        .map_err(|error| TunnelSessionError::ParseControl(error.to_string()))?;
    agent_stream
        .stats
        .record_credit_restore(bytes, restored_at_ms);
    Ok(true)
}

pub(super) fn forward_gateway_frame_to_agent(
    tunnel_writer_sender: &mpsc::UnboundedSender<TunnelWriterMessage>,
    session_state: &mut TunnelSessionMutableState,
    clock: &dyn Clock,
    frame: StreamDataFrame,
) -> Result<(), TunnelSessionError> {
    let payload_bytes = frame.payload.len();
    match frame.payload_kind {
        PAYLOAD_KIND_WEBSOCKET_TEXT => {
            let payload = String::from_utf8(frame.payload)
                .map_err(|error| TunnelSessionError::AgentWrite(error.to_string()))?;
            let Some(agent_stream) = session_state.agent_streams.get_mut(&frame.stream_id) else {
                return Ok(());
            };
            agent_stream
                .sender
                .send(Message::Text(payload.into()))
                .map_err(|error| TunnelSessionError::AgentWrite(error.to_string()))?;
            agent_stream.stats.record_inbound_message(payload_bytes);
        }
        PAYLOAD_KIND_WEBSOCKET_BINARY => {
            let Some(agent_stream) = session_state.agent_streams.get_mut(&frame.stream_id) else {
                return Ok(());
            };
            agent_stream
                .sender
                .send(Message::Binary(frame.payload.into()))
                .map_err(|error| TunnelSessionError::AgentWrite(error.to_string()))?;
            agent_stream.stats.record_inbound_message(payload_bytes);
        }
        _ => {
            let reason = "agent stream only accepts websocket text or binary payload kinds";
            if let Some(agent_stream) = remove_agent_stream_and_publish_summary(
                tunnel_writer_sender,
                session_state,
                clock,
                frame.stream_id,
                AgentStreamTermination {
                    outcome: AGENT_STREAM_OUTCOME_RESET,
                    close_source: AGENT_STREAM_CLOSE_SOURCE_GATEWAY,
                    reset_code: Some(STREAM_RESET_CODE_INVALID_STREAM_DATA),
                    reason: Some(reason.to_string()),
                },
            ) {
                let _ = agent_stream.sender.send(Message::Close(None));
            }
            write_tunnel_text(
                tunnel_writer_sender,
                stream_reset(
                    frame.stream_id,
                    STREAM_RESET_CODE_INVALID_STREAM_DATA,
                    reason,
                ),
            )?;
        }
    }
    Ok(())
}

pub(super) fn handle_agent_runtime_message(
    tunnel_writer_sender: &mpsc::UnboundedSender<TunnelWriterMessage>,
    session_state: &mut TunnelSessionMutableState,
    clock: &dyn Clock,
    stream_id: u32,
    message: Message,
) -> Result<(), TunnelSessionError> {
    match message {
        Message::Text(payload) => publish_agent_runtime_payload(
            tunnel_writer_sender,
            session_state,
            clock,
            stream_id,
            PAYLOAD_KIND_WEBSOCKET_TEXT,
            payload.as_bytes(),
        ),
        Message::Binary(payload) => publish_agent_runtime_payload(
            tunnel_writer_sender,
            session_state,
            clock,
            stream_id,
            PAYLOAD_KIND_WEBSOCKET_BINARY,
            payload.as_ref(),
        ),
        Message::Ping(payload) => {
            if let Some(agent_stream) = session_state.agent_streams.get(&stream_id) {
                agent_stream
                    .sender
                    .send(Message::Pong(payload))
                    .map_err(|error| TunnelSessionError::AgentWrite(error.to_string()))?;
            }
            Ok(())
        }
        Message::Pong(_) => Ok(()),
        Message::Close(_) => {
            remove_agent_stream_and_publish_summary(
                tunnel_writer_sender,
                session_state,
                clock,
                stream_id,
                AgentStreamTermination {
                    outcome: AGENT_STREAM_OUTCOME_RESET,
                    close_source: AGENT_STREAM_CLOSE_SOURCE_RUNTIME,
                    reset_code: Some(STREAM_RESET_CODE_TARGET_CLOSED),
                    reason: Some("agent runtime websocket closed".to_string()),
                },
            );
            write_tunnel_text(
                tunnel_writer_sender,
                stream_reset(
                    stream_id,
                    STREAM_RESET_CODE_TARGET_CLOSED,
                    "agent runtime websocket closed",
                ),
            )
        }
        _ => Ok(()),
    }
}

fn publish_agent_runtime_payload(
    tunnel_writer_sender: &mpsc::UnboundedSender<TunnelWriterMessage>,
    session_state: &mut TunnelSessionMutableState,
    clock: &dyn Clock,
    stream_id: u32,
    payload_kind: u8,
    payload: &[u8],
) -> Result<(), TunnelSessionError> {
    let now_ms = clock.now_ms();
    let payload_bytes = payload.len();
    let accepted =
        match reserve_agent_stream_send_window(session_state, stream_id, payload_bytes, now_ms) {
            Some(Ok(accepted)) => accepted,
            Some(Err(telemetry)) => {
                publish_agent_stream_window_exhausted(
                    tunnel_writer_sender,
                    &mut session_state.telemetry_relay,
                    clock,
                    AgentStreamWindowExhaustedTelemetry {
                        stream_id,
                        payload_kind: websocket_payload_kind_name(payload_kind),
                        payload_bytes,
                        available_bytes: telemetry.available_bytes,
                        outstanding_bytes: telemetry.outstanding_bytes,
                        message_count_out: telemetry.message_count_out,
                        stream_age_ms: telemetry.stream_age_ms,
                        oldest_unacked_ms: telemetry.oldest_unacked_ms,
                    },
                );
                remove_agent_stream_and_publish_summary(
                    tunnel_writer_sender,
                    session_state,
                    clock,
                    stream_id,
                    AgentStreamTermination {
                        outcome: AGENT_STREAM_OUTCOME_RESET,
                        close_source: AGENT_STREAM_CLOSE_SOURCE_RUNTIME,
                        reset_code: Some(STREAM_RESET_CODE_STREAM_WINDOW_EXHAUSTED),
                        reason: Some("agent stream send window is exhausted".to_string()),
                    },
                );
                return write_tunnel_text(
                    tunnel_writer_sender,
                    stream_reset(
                        stream_id,
                        STREAM_RESET_CODE_STREAM_WINDOW_EXHAUSTED,
                        "agent stream send window is exhausted",
                    ),
                );
            }
            None => return Ok(()),
        };

    for threshold_bytes in accepted.threshold_crossings {
        publish_agent_stream_threshold_crossed(
            tunnel_writer_sender,
            &mut session_state.telemetry_relay,
            clock,
            AgentStreamThresholdTelemetry {
                stream_id,
                payload_kind: websocket_payload_kind_name(payload_kind),
                payload_bytes,
                available_bytes: accepted.telemetry.available_bytes,
                outstanding_bytes: accepted.telemetry.outstanding_bytes,
                threshold_bytes,
                message_count_out: accepted.telemetry.message_count_out,
                stream_age_ms: accepted.telemetry.stream_age_ms,
                oldest_unacked_ms: accepted.telemetry.oldest_unacked_ms,
            },
        );
    }

    let encoded = encode_stream_data_frame(stream_id, payload_kind, payload)
        .map_err(|error| TunnelSessionError::AgentRead(error.to_string()))?;
    write_tunnel_binary(tunnel_writer_sender, encoded)
}

fn reserve_agent_stream_send_window(
    session_state: &mut TunnelSessionMutableState,
    stream_id: u32,
    payload_bytes: usize,
    now_ms: u64,
) -> Option<Result<AgentOutboundAccepted, AgentOutboundTelemetry>> {
    let agent_stream = session_state.agent_streams.get_mut(&stream_id)?;
    let available_bytes = agent_stream.send_window.available_bytes();
    if !agent_stream.send_window.try_consume(payload_bytes) {
        return Some(Err(AgentOutboundTelemetry {
            available_bytes,
            outstanding_bytes: agent_stream_outstanding_bytes(&agent_stream.send_window),
            message_count_out: agent_stream.stats.message_count_out,
            stream_age_ms: agent_stream.stats.stream_age_ms(now_ms),
            oldest_unacked_ms: agent_stream.stats.oldest_unacked_age_ms(now_ms),
        }));
    }

    let available_after = agent_stream.send_window.available_bytes();
    let outstanding_bytes = agent_stream_outstanding_bytes(&agent_stream.send_window);
    agent_stream
        .stats
        .record_outbound_message(payload_bytes, now_ms, outstanding_bytes);
    let threshold_crossings = agent_stream
        .stats
        .take_new_threshold_crossings(outstanding_bytes);

    Some(Ok(AgentOutboundAccepted {
        telemetry: AgentOutboundTelemetry {
            available_bytes: available_after,
            outstanding_bytes,
            message_count_out: agent_stream.stats.message_count_out,
            stream_age_ms: agent_stream.stats.stream_age_ms(now_ms),
            oldest_unacked_ms: agent_stream.stats.oldest_unacked_age_ms(now_ms),
        },
        threshold_crossings,
    }))
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
