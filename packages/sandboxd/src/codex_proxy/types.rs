use std::collections::{BTreeMap, BTreeSet};
use std::time::Instant;

use serde::Deserialize;
use serde_json::Value;
use tokio::sync::oneshot;
use tungstenite::Message;

use crate::codex_proxy::CodexThreadStatus;

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
pub enum RetainReason {
    MistleAgentBackgroundExecution,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CodexSessionManagerHealthState {
    Starting,
    Connected,
    Disconnected,
}

impl CodexSessionManagerHealthState {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Starting => "Starting",
            Self::Connected => "Connected",
            Self::Disconnected => "Disconnected",
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ThreadSubscriptionState {
    Requested,
    Subscribed,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RetainedThreadState {
    pub retain_reasons: BTreeSet<RetainReason>,
    pub last_status: Option<CodexThreadStatus>,
    pub subscription_state: ThreadSubscriptionState,
}

impl Default for RetainedThreadState {
    fn default() -> Self {
        Self {
            retain_reasons: BTreeSet::new(),
            last_status: None,
            subscription_state: ThreadSubscriptionState::Requested,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CodexSessionManagerState {
    pub retained_threads: BTreeMap<String, RetainedThreadState>,
    pub next_request_id: u64,
    pub initialized: bool,
    pub retention_replay_in_progress: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ProxyClientKind {
    Unknown,
    MistleAgentClient,
    Other,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum DeliveryContextSource {
    Schedule,
    Webhook,
}

impl DeliveryContextSource {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Schedule => "schedule",
            Self::Webhook => "webhook",
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DeliveryContext {
    pub traceparent: String,
    pub tracestate: Option<String>,
    pub baggage: Option<String>,
    pub source: DeliveryContextSource,
    pub webhook_event_id: Option<String>,
    pub scheduled_action_id: Option<String>,
    pub delivery_task_id: String,
    pub external_delivery_id: Option<String>,
    pub trigger_run_id: String,
    pub conversation_id: String,
    pub sandbox_instance_id: String,
    pub route_id: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DeliveryContextPayload {
    pub traceparent: String,
    pub tracestate: Option<String>,
    pub baggage: Option<String>,
    pub source: DeliveryContextSource,
    pub webhook_event_id: Option<String>,
    pub scheduled_action_id: Option<String>,
    pub delivery_task_id: String,
    pub external_delivery_id: Option<String>,
    pub trigger_run_id: String,
    pub conversation_id: String,
    pub sandbox_instance_id: String,
    pub route_id: Option<String>,
}

impl TryFrom<DeliveryContextPayload> for DeliveryContext {
    type Error = String;

    fn try_from(value: DeliveryContextPayload) -> Result<Self, Self::Error> {
        match value.source {
            DeliveryContextSource::Schedule => {
                if value.scheduled_action_id.is_none() {
                    return Err("schedule delivery context requires scheduledActionId".to_string());
                }
                if value.webhook_event_id.is_some() {
                    return Err(
                        "schedule delivery context must not include webhookEventId".to_string()
                    );
                }
            }
            DeliveryContextSource::Webhook => {
                if value.webhook_event_id.is_none() {
                    return Err("webhook delivery context requires webhookEventId".to_string());
                }
                if value.scheduled_action_id.is_some() {
                    return Err(
                        "webhook delivery context must not include scheduledActionId".to_string(),
                    );
                }
            }
        }

        Ok(Self {
            traceparent: value.traceparent,
            tracestate: value.tracestate,
            baggage: value.baggage,
            source: value.source,
            webhook_event_id: value.webhook_event_id,
            scheduled_action_id: value.scheduled_action_id,
            delivery_task_id: value.delivery_task_id,
            external_delivery_id: value.external_delivery_id,
            trigger_run_id: value.trigger_run_id,
            conversation_id: value.conversation_id,
            sandbox_instance_id: value.sandbox_instance_id,
            route_id: value.route_id,
        })
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PendingClientRequest {
    pub method: String,
    pub thread_id: Option<String>,
    pub expected_turn_id: Option<String>,
    pub interruption_source: Option<String>,
    pub interruption_expected: Option<bool>,
    pub compaction_trigger: Option<String>,
    pub request_started_at: Instant,
    pub delivery_context: Option<DeliveryContext>,
}

#[derive(Debug)]
pub struct BufferedSuccessResponse {
    pub request_id: Value,
    pub response_sequence: u64,
    pub payload: Message,
    pub subscription_retention_result: Option<Result<(), CodexSessionManagerError>>,
}

impl Default for CodexSessionManagerState {
    fn default() -> Self {
        Self {
            retained_threads: BTreeMap::new(),
            next_request_id: 3,
            initialized: false,
            retention_replay_in_progress: false,
        }
    }
}

pub type CommandReply = oneshot::Sender<Result<(), CodexSessionManagerError>>;

#[derive(Debug)]
pub enum CodexSessionManagerCommand {
    RetainThread {
        thread_id: String,
        reason: RetainReason,
        reply: CommandReply,
    },
    ReleaseThread {
        thread_id: String,
        reason: RetainReason,
        reply: CommandReply,
    },
    Shutdown,
}

#[derive(Debug)]
pub enum CodexSessionManagerError {
    CommandChannelClosed,
    RequestRejected {
        method: &'static str,
        message: String,
    },
    RequestFailed {
        method: &'static str,
        message: String,
    },
}

impl std::fmt::Display for CodexSessionManagerError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::CommandChannelClosed => {
                write!(f, "Codex session manager command channel is closed")
            }
            Self::RequestRejected { method, message } => {
                write!(
                    f,
                    "Codex session manager request '{method}' was rejected: {message}"
                )
            }
            Self::RequestFailed { method, message } => {
                write!(
                    f,
                    "Codex session manager request '{method}' failed: {message}"
                )
            }
        }
    }
}

impl std::error::Error for CodexSessionManagerError {}
