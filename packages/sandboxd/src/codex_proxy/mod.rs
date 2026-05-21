//! Codex app-server proxying, keepalive monitoring, and readiness tracking for `sandboxd`.
//!
//! Codex app-server keeps turn execution in one long-lived daemon process, so
//! process-level supervision alone cannot tell `sandboxd` whether Codex work is
//! still in flight. This module adds the runtime-specific adapter surface while
//! keeping proxy relay, session-manager, supervision, and message parsing details
//! scoped to focused private modules.

mod error;
mod message;
mod monitor;
mod proxy_session;
mod runtime;
mod session_manager;
mod supervisor;
mod types;

pub use crate::codex_proxy::error::CodexProxyError;
pub use crate::codex_proxy::message::{CodexThreadStatus, RawCodexSocket};
pub use crate::codex_proxy::monitor::CodexMonitor;
pub use crate::codex_proxy::session_manager::{
    CodexSessionManagerHandle, spawn_codex_session_manager,
};
pub use crate::codex_proxy::supervisor::{
    CodexProxy, CodexProxyControlHandle, start_codex_proxy, start_codex_proxy_with_supervisor,
};
pub use crate::codex_proxy::types::{
    BufferedSuccessResponse, CodexSessionManagerCommand, CodexSessionManagerError,
    CodexSessionManagerHealthState, CodexSessionManagerState, PendingClientRequest,
    ProxyClientKind, RetainReason, RetainedThreadState, ThreadSubscriptionState,
};

/// Default public listener URL for the Codex proxy endpoint.
pub const DEFAULT_CODEX_PROXY_LISTEN_URL: &str = "ws://127.0.0.1:4500";
/// Default internal raw Codex app-server URL.
pub const DEFAULT_CODEX_RAW_APP_SERVER_URL: &str = "ws://127.0.0.1:4501";
/// Delay before the monitor reconnects after a dropped raw app-server connection.
pub const DEFAULT_CODEX_MONITOR_RECONNECT_INTERVAL: std::time::Duration =
    std::time::Duration::from_millis(100);
/// The Codex client identity accepted by ChatGPT-backed OpenAI endpoints.
pub const CODEX_INITIALIZE_CLIENT_NAME: &str = "codex_cli_rs";
/// Shared title for Mistle-managed Codex clients whose turns must survive reconnects.
pub const MISTLE_AGENT_CLIENT_TITLE: &str = "Mistle Agent Client";
