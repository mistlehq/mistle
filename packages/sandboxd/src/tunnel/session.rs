//! Live bootstrap tunnel session orchestration for `sandboxd`.
//!
//! The public facade exposes the session handle and request/response types.
//! The implementation is split by responsibility under `session/` so the root
//! module stays thin while routing, lifecycle, stream, and protocol details
//! remain scoped to their owning modules.

use crate::time::Duration;

pub use crate::tunnel::session::egress::{GatewayEgressTokenProvider, TunnelEgressToken};
pub use crate::tunnel::session::error::TunnelSessionError;
pub use crate::tunnel::session::handle::TunnelSession;
pub(crate) use crate::tunnel::session::handle::derive_sandbox_instance_id;
pub use crate::tunnel::session::operation::OperationStreamMessage;
pub use crate::tunnel::session::signing::{TunnelSigningRequest, TunnelSigningResponse};

mod agent;
mod bootstrap;
mod egress;
mod error;
mod exec;
mod file_search;
mod file_upload;
mod handle;
mod lifecycle;
mod operation;
mod port_access;
mod process;
mod pty;
mod router;
mod runner;
mod signing;
mod state;
mod telemetry;

/// Default attachment root for file uploads received over the bootstrap tunnel.
pub const DEFAULT_ATTACHMENT_ROOT: &str = "/root/.local/attachments";
/// Poll interval while the live tunnel session has no immediately available work.
pub const DEFAULT_TUNNEL_SESSION_POLL_INTERVAL: Duration = Duration::from_millis(10);
pub const SANDBOX_OPERATION_STREAM_ID: u32 = 0xffff_fffd;
/// Poll interval while PTY output threads wait for the next blocking event.
pub const DEFAULT_PTY_EVENT_POLL_INTERVAL: Duration = Duration::from_millis(10);
/// Maximum time to wait for bootstrap tunnel DNS resolution.
pub const DEFAULT_BOOTSTRAP_TUNNEL_LOOKUP_TIMEOUT: Duration = Duration::from_secs(10);
/// Maximum time to wait for one bootstrap tunnel TCP dial.
pub const DEFAULT_BOOTSTRAP_TUNNEL_CONNECT_TIMEOUT: Duration = Duration::from_secs(10);
/// Maximum time to wait for the bootstrap websocket handshake.
pub const DEFAULT_BOOTSTRAP_TUNNEL_HANDSHAKE_TIMEOUT: Duration = Duration::from_secs(10);
pub(in crate::tunnel::session) const TUNNEL_RECONNECT_BACKOFF_MS: [u64; 6] =
    [0, 250, 500, 1000, 2000, 5000];

#[cfg(test)]
mod tests;
