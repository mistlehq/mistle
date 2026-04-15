use std::collections::{BTreeMap, BTreeSet};

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

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PendingClientRequest {
    pub method: String,
    pub thread_id: Option<String>,
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
