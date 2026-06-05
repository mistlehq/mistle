//! Shared runtime and loop state for the live tunnel session.

use std::collections::{BTreeMap, VecDeque};
use std::path::{Path, PathBuf};
use std::sync::atomic::AtomicBool;
use std::sync::{Arc, Mutex, RwLock};

use tokio::sync::mpsc;
use tokio::task::JoinHandle as TokioJoinHandle;
use tokio_tungstenite::tungstenite::Message;

use crate::keepalive::KeepaliveManager;
use crate::process::PlatformProcessRegistry;
use crate::runtime::readiness::RuntimeReadinessManager;
use crate::supervision::SandboxdSupervisorHandle;
use crate::time::{Clock, Sleeper};
use crate::tunnel::file_search::FileSearchWorkerEvent;
use crate::tunnel::port_access_transport::{PortAccessHttpCommand, PortAccessTransportEvent};
use crate::tunnel::protocol::StreamSendWindow;
use crate::tunnel::session::agent::AgentStreamState;
use crate::tunnel::session::bootstrap::TunnelWebSocket;
use crate::tunnel::session::exec::{ExecCommandResult, PendingExecOpenState};
use crate::tunnel::session::file_search::FileSearchStreamState;
use crate::tunnel::session::file_upload::FileUploadState;
use crate::tunnel::session::port_access::PortAccessTcpStreamState;
use crate::tunnel::session::process::ProcessStreamState;
use crate::tunnel::session::{
    TunnelEgressToken, TunnelSessionError, TunnelSigningRequest, TunnelSigningResponse,
};
use crate::tunnel::telemetry::TelemetryRelay;

pub(in crate::tunnel::session) enum TunnelSessionControlFlow {
    Continue,
    RestartRequired,
    ShutdownRequested,
}

pub(in crate::tunnel::session) enum ConnectedTunnelSessionOutcome {
    ShutdownRequested,
    RestartRequired,
}

pub(in crate::tunnel::session) struct ConnectedTunnelSessionResult {
    pub(in crate::tunnel::session) outcome: ConnectedTunnelSessionOutcome,
    pub(in crate::tunnel::session) startup_completed: bool,
}

pub(in crate::tunnel::session) enum ConnectedTunnelSessionLoopItem {
    Event(TunnelSessionEvent),
    Request(TunnelSessionRequest),
}

pub(in crate::tunnel::session) enum TunnelSessionEvent {
    BootstrapMessage(Message),
    BootstrapClosed {
        is_gateway_service_restart: bool,
        reason: Option<String>,
    },
    AgentDialed {
        stream_id: u32,
        result: Box<Result<TunnelWebSocket, String>>,
    },
    AgentMessage {
        stream_id: u32,
        message: Message,
    },
    AgentWriteCompleted {
        stream_id: u32,
        bytes: usize,
    },
    PortAccessTransport(PortAccessTransportEvent),
    AgentClosed {
        stream_id: u32,
        reason: Option<String>,
    },
    ExecCompleted {
        stream_id: u32,
        result: Box<Result<ExecCommandResult, String>>,
    },
    FileSearch(FileSearchWorkerEvent),
    Wake,
}

pub(in crate::tunnel::session) enum TunnelSessionRequest {
    Shutdown,
    SetAgentEndpoint {
        agent_endpoint_url: Option<String>,
        response_sender: std::sync::mpsc::Sender<Result<(), TunnelSessionError>>,
    },
    SetRuntimeEnvironment {
        runtime_env: BTreeMap<String, String>,
        response_sender: std::sync::mpsc::Sender<Result<(), TunnelSessionError>>,
    },
    Signing {
        request: Box<TunnelSigningRequest>,
        response_sender: std::sync::mpsc::Sender<Result<TunnelSigningResponse, TunnelSessionError>>,
    },
    EgressToken {
        request_id: String,
        acting_user_id: Option<String>,
        response_sender: std::sync::mpsc::Sender<Result<TunnelEgressToken, TunnelSessionError>>,
    },
    OperationRecord {
        line: String,
    },
    OperationClose {
        response_sender: std::sync::mpsc::Sender<Result<(), String>>,
    },
}

pub(in crate::tunnel::session) struct PendingAgentOpenState {
    pub(in crate::tunnel::session) task: TokioJoinHandle<()>,
}

pub(in crate::tunnel::session) struct TunnelSessionRuntime {
    pub(in crate::tunnel::session) keepalive_manager: Arc<Mutex<KeepaliveManager>>,
    pub(in crate::tunnel::session) platform_process_registry: PlatformProcessRegistry,
    pub(in crate::tunnel::session) runtime_readiness_manager: Arc<Mutex<RuntimeReadinessManager>>,
    pub(in crate::tunnel::session) connection_state:
        Arc<RwLock<TunnelSessionRuntimeConnectionState>>,
    pub(in crate::tunnel::session) cgroup_root: PathBuf,
    pub(in crate::tunnel::session) attachment_root: PathBuf,
    pub(in crate::tunnel::session) sandbox_instance_id: String,
    pub(in crate::tunnel::session) gateway_ws_url: String,
    pub(in crate::tunnel::session) operation_id: Option<String>,
    pub(in crate::tunnel::session) operation_kind: &'static str,
    pub(in crate::tunnel::session) transparent_passthrough_socket_mark: Option<u32>,
    pub(in crate::tunnel::session) shutdown_requested: Arc<AtomicBool>,
    pub(in crate::tunnel::session) clock: Arc<dyn Clock>,
    pub(in crate::tunnel::session) sleeper: Arc<dyn Sleeper>,
    pub(in crate::tunnel::session) supervisor_handle: SandboxdSupervisorHandle,
}

#[derive(Clone)]
pub(in crate::tunnel::session) struct TunnelSessionRuntimeConnectionState {
    pub(in crate::tunnel::session) agent_endpoint_url: Option<String>,
    pub(in crate::tunnel::session) runtime_env: BTreeMap<String, String>,
}

pub(in crate::tunnel::session) struct TunnelSessionLoopContext<'a> {
    pub(in crate::tunnel::session) attachment_root: &'a Path,
    pub(in crate::tunnel::session) cgroup_root: &'a Path,
    pub(in crate::tunnel::session) sandbox_instance_id: &'a str,
    pub(in crate::tunnel::session) gateway_ws_url: &'a str,
    pub(in crate::tunnel::session) clock: &'a dyn Clock,
    pub(in crate::tunnel::session) platform_process_registry: PlatformProcessRegistry,
    pub(in crate::tunnel::session) supervisor_handle: &'a SandboxdSupervisorHandle,
}

pub(in crate::tunnel::session) struct TunnelSessionMutableState {
    pub(in crate::tunnel::session) agent_endpoint_url: Option<String>,
    pub(in crate::tunnel::session) runtime_env: BTreeMap<String, String>,
    pub(in crate::tunnel::session) telemetry_relay: TelemetryRelay,
    pub(in crate::tunnel::session) pending_signing_requests: BTreeMap<
        String,
        std::sync::mpsc::Sender<Result<TunnelSigningResponse, TunnelSessionError>>,
    >,
    pub(in crate::tunnel::session) pending_egress_token_requests:
        BTreeMap<String, std::sync::mpsc::Sender<Result<TunnelEgressToken, TunnelSessionError>>>,
    pub(in crate::tunnel::session) pending_agent_opens: BTreeMap<u32, PendingAgentOpenState>,
    pub(in crate::tunnel::session) pending_exec_opens: BTreeMap<u32, PendingExecOpenState>,
    pub(in crate::tunnel::session) agent_streams: BTreeMap<u32, AgentStreamState>,
    pub(in crate::tunnel::session) port_access_http_streams:
        BTreeMap<u32, mpsc::UnboundedSender<PortAccessHttpCommand>>,
    pub(in crate::tunnel::session) port_access_tcp_streams: BTreeMap<u32, PortAccessTcpStreamState>,
    pub(in crate::tunnel::session) process_streams: ProcessStreamState,
    pub(in crate::tunnel::session) file_search_streams: BTreeMap<u32, FileSearchStreamState>,
    pub(in crate::tunnel::session) operation_stream_requested: bool,
    pub(in crate::tunnel::session) operation_stream_close_requested: bool,
    pub(in crate::tunnel::session) operation_stream_close_response_sender:
        Option<std::sync::mpsc::Sender<Result<(), String>>>,
    pub(in crate::tunnel::session) operation_stream_send_window: Option<StreamSendWindow>,
    pub(in crate::tunnel::session) pending_operation_records: VecDeque<String>,
    pub(in crate::tunnel::session) file_uploads: BTreeMap<u32, FileUploadState>,
}

pub(in crate::tunnel::session) fn continue_with(
    result: Result<(), TunnelSessionError>,
) -> Result<TunnelSessionControlFlow, TunnelSessionError> {
    result.map(|()| TunnelSessionControlFlow::Continue)
}
