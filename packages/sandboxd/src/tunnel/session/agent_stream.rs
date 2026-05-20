//! Agent websocket stream state owned by the live tunnel session.

use std::collections::VecDeque;

use tokio::sync::mpsc;
use tokio_tungstenite::tungstenite::Message;

use crate::tunnel::protocol::{
    AGENT_STREAM_WINDOW_BYTES, PAYLOAD_KIND_WEBSOCKET_BINARY, PAYLOAD_KIND_WEBSOCKET_TEXT,
    StreamSendWindow,
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
