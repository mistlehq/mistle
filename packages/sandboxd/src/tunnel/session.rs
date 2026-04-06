//! Live bootstrap tunnel session orchestration for `sandboxd`.
//!
//! Once the daemon has initialized the sandbox runtime, it needs one loop that
//! owns the connected bootstrap websocket and routes multiplexed tunnel
//! traffic: keepalive publication, telemetry negotiation, agent-runtime
//! websocket streams, PTY streams, and file uploads.

use std::collections::{BTreeMap, BTreeSet};
use std::fmt::{self, Display};
use std::fs::{self, File, OpenOptions};
use std::io::{self, Read, Write};
use std::net::TcpStream;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::thread::{self, JoinHandle};

use tungstenite::stream::MaybeTlsStream;
use tungstenite::{Error as WebSocketError, Message, WebSocket, connect};
use url::Url;

use crate::cgroups::DEFAULT_CGROUP_ROOT;
use crate::keepalive::KeepaliveManager;
use crate::protocol::startup::StartupInput;
use crate::pty::{
    DEFAULT_PTY_TERMINATE_POLL_INTERVAL, DEFAULT_PTY_TERMINATE_TIMEOUT_MS, PtyEvent, PtySession,
    PtySpawnRequest, start_scoped_pty_session,
};
use crate::runtime::readiness::RuntimeReadinessManager;
use crate::time::{Clock, Duration, Sleeper};
use crate::tunnel::BootstrapTunnel;
use crate::tunnel::protocol::{
    CONNECT_ERROR_CODE_AGENT_ENDPOINT_DIAL_FAILED, CONNECT_ERROR_CODE_PTY_SESSION_CREATE_FAILED,
    CONNECT_ERROR_CODE_PTY_SESSION_EXISTS, CONNECT_ERROR_CODE_PTY_SESSION_UNAVAILABLE,
    FILE_UPLOAD_RESET_CODE_BYTE_COUNT_EXCEEDED, FILE_UPLOAD_RESET_CODE_BYTE_COUNT_MISMATCH,
    FILE_UPLOAD_RESET_CODE_INVALID_FILE_TYPE, FILE_UPLOAD_RESET_CODE_MIME_TYPE_MISMATCH,
    PAYLOAD_KIND_RAW_BYTES, PAYLOAD_KIND_WEBSOCKET_BINARY, PAYLOAD_KIND_WEBSOCKET_TEXT,
    STREAM_RESET_CODE_INVALID_STREAM_CLOSE, STREAM_RESET_CODE_INVALID_STREAM_DATA,
    STREAM_RESET_CODE_INVALID_STREAM_SIGNAL, STREAM_RESET_CODE_INVALID_STREAM_WINDOW,
    STREAM_RESET_CODE_STREAM_CLOSE_FAILED, STREAM_RESET_CODE_STREAM_WINDOW_EXHAUSTED,
    STREAM_RESET_CODE_TARGET_CLOSED, StreamControlMessage, StreamSendWindow,
    decode_stream_data_frame, encode_stream_data_frame, file_upload_completed_event,
    parse_stream_control_message, pty_exit_event, stream_complete, stream_open_error,
    stream_open_ok, stream_reset, stream_window,
};
use crate::tunnel::telemetry::TelemetryRelay;

/// Default attachment root for file uploads received over the bootstrap tunnel.
pub const DEFAULT_ATTACHMENT_ROOT: &str = "/tmp/attachments";
/// Poll interval while the live tunnel session has no immediately available work.
pub const DEFAULT_TUNNEL_SESSION_POLL_INTERVAL: Duration = Duration::from_millis(10);
const MAX_UPLOAD_SIZE_BYTES: usize = 10 * 1024 * 1024;
const MAX_UPLOAD_THREAD_ID_LENGTH: usize = 128;
const PNG_SIGNATURE: &[u8] = &[0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const JPEG_SIGNATURE: &[u8] = &[0xff, 0xd8, 0xff];
const GIF87A_SIGNATURE: &[u8] = &[0x47, 0x49, 0x46, 0x38, 0x37, 0x61];
const GIF89A_SIGNATURE: &[u8] = &[0x47, 0x49, 0x46, 0x38, 0x39, 0x61];
const WEBP_RIFF_SIGNATURE: &[u8] = &[0x52, 0x49, 0x46, 0x46];
const WEBP_BRAND_SIGNATURE: &[u8] = &[0x57, 0x45, 0x42, 0x50];

static UPLOAD_ID_COUNTER: AtomicU64 = AtomicU64::new(1);

/// Describes why the live bootstrap tunnel session could not start or stop.
#[derive(Debug)]
pub enum TunnelSessionError {
    InvalidGatewayUrl(String),
    ConfigureTunnelSocket(String),
    AttachmentRoot(String),
    AttachTelemetry(String),
    HandleTelemetry(String),
    PublishKeepalive(serde_json::Error),
    PublishRuntimeReady(serde_json::Error),
    WriteTunnelText(String),
    WriteTunnelBinary(String),
    ReadTunnel(String),
    ParseControl(String),
    ParseDataFrame(String),
    AgentDial(String),
    AgentSocket(String),
    AgentRead(String),
    AgentWrite(String),
    Pty(String),
    FileUpload(String),
    SessionPanicked,
}

impl Display for TunnelSessionError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::InvalidGatewayUrl(error) => {
                write!(
                    f,
                    "failed to derive sandbox instance id from tunnel url: {error}"
                )
            }
            Self::ConfigureTunnelSocket(error) => {
                write!(f, "failed to configure bootstrap tunnel socket: {error}")
            }
            Self::AttachmentRoot(error) => write!(f, "failed to prepare attachment root: {error}"),
            Self::AttachTelemetry(error) => {
                write!(f, "failed to attach telemetry relay: {error}")
            }
            Self::HandleTelemetry(error) => {
                write!(f, "failed to handle bootstrap telemetry control: {error}")
            }
            Self::PublishKeepalive(error) => {
                write!(f, "failed to serialize keepalive payload: {error}")
            }
            Self::PublishRuntimeReady(error) => {
                write!(f, "failed to serialize runtime readiness payload: {error}")
            }
            Self::WriteTunnelText(error) => {
                write!(f, "failed to write bootstrap tunnel text frame: {error}")
            }
            Self::WriteTunnelBinary(error) => {
                write!(f, "failed to write bootstrap tunnel binary frame: {error}")
            }
            Self::ReadTunnel(error) => write!(f, "failed to read bootstrap tunnel frame: {error}"),
            Self::ParseControl(error) => {
                write!(f, "invalid bootstrap tunnel control frame: {error}")
            }
            Self::ParseDataFrame(error) => {
                write!(f, "invalid bootstrap tunnel data frame: {error}")
            }
            Self::AgentDial(error) => {
                write!(f, "failed to connect agent runtime endpoint: {error}")
            }
            Self::AgentSocket(error) => {
                write!(f, "failed to configure agent runtime socket: {error}")
            }
            Self::AgentRead(error) => write!(f, "failed to read agent runtime socket: {error}"),
            Self::AgentWrite(error) => write!(f, "failed to write agent runtime socket: {error}"),
            Self::Pty(error) => write!(f, "failed to handle PTY tunnel stream: {error}"),
            Self::FileUpload(error) => write!(f, "failed to handle file upload stream: {error}"),
            Self::SessionPanicked => write!(f, "bootstrap tunnel session thread panicked"),
        }
    }
}

impl std::error::Error for TunnelSessionError {}

/// Owns the background tunnel session thread for the initialized daemon.
pub struct TunnelSession {
    shutdown_requested: Arc<AtomicBool>,
    thread: Option<JoinHandle<Result<(), TunnelSessionError>>>,
}

impl TunnelSession {
    /// Starts one live bootstrap tunnel session thread for the initialized daemon.
    pub fn start(
        startup_input: &StartupInput,
        tunnel: BootstrapTunnel,
        keepalive_manager: Arc<Mutex<KeepaliveManager>>,
        runtime_readiness_manager: Arc<Mutex<RuntimeReadinessManager>>,
        agent_endpoint_url: Option<String>,
        clock: Arc<dyn Clock>,
        sleeper: Arc<dyn Sleeper>,
    ) -> Result<Self, TunnelSessionError> {
        let sandbox_instance_id = derive_sandbox_instance_id(&startup_input.tunnel_gateway_ws_url)?;
        let attachment_root = PathBuf::from(DEFAULT_ATTACHMENT_ROOT);
        fs::create_dir_all(&attachment_root)
            .map_err(|error| TunnelSessionError::AttachmentRoot(error.to_string()))?;

        let shutdown_requested = Arc::new(AtomicBool::new(false));
        let thread = Some(thread::spawn({
            let shutdown_requested = shutdown_requested.clone();
            let cgroup_root = PathBuf::from(DEFAULT_CGROUP_ROOT);
            let runtime = TunnelSessionRuntime {
                keepalive_manager,
                runtime_readiness_manager,
                agent_endpoint_url,
                cgroup_root,
                attachment_root,
                sandbox_instance_id,
                shutdown_requested,
                clock,
                sleeper,
            };
            move || run_tunnel_session_loop(tunnel, runtime)
        }));

        Ok(Self {
            shutdown_requested,
            thread,
        })
    }

    /// Stops the live bootstrap tunnel session and waits for its thread to exit.
    pub fn close(mut self) -> Result<(), TunnelSessionError> {
        self.shutdown_requested.store(true, Ordering::Relaxed);
        let thread = self
            .thread
            .take()
            .expect("tunnel session thread should exist");

        match thread.join() {
            Ok(result) => result,
            Err(_) => Err(TunnelSessionError::SessionPanicked),
        }
    }
}

struct AgentStreamState {
    runtime_socket: WebSocket<MaybeTlsStream<TcpStream>>,
    send_window: StreamSendWindow,
}

struct PtySessionState {
    session: PtySession,
    primary_stream_id: u32,
    attached_stream_ids: BTreeSet<u32>,
    send_windows_by_stream_id: BTreeMap<u32, StreamSendWindow>,
}

struct FileUploadState {
    thread_id: String,
    mime_type: String,
    original_filename: String,
    size_bytes: usize,
    temp_path: PathBuf,
    final_path: PathBuf,
    file: File,
    received_bytes: usize,
}

struct TunnelSessionRuntime {
    keepalive_manager: Arc<Mutex<KeepaliveManager>>,
    runtime_readiness_manager: Arc<Mutex<RuntimeReadinessManager>>,
    agent_endpoint_url: Option<String>,
    cgroup_root: PathBuf,
    attachment_root: PathBuf,
    sandbox_instance_id: String,
    shutdown_requested: Arc<AtomicBool>,
    clock: Arc<dyn Clock>,
    sleeper: Arc<dyn Sleeper>,
}

struct TunnelSessionLoopContext<'a> {
    agent_endpoint_url: Option<&'a str>,
    attachment_root: &'a Path,
    cgroup_root: &'a Path,
    sandbox_instance_id: &'a str,
    clock: &'a dyn Clock,
    sleeper: &'a dyn Sleeper,
}

fn run_tunnel_session_loop(
    mut tunnel: BootstrapTunnel,
    runtime: TunnelSessionRuntime,
) -> Result<(), TunnelSessionError> {
    let socket = tunnel
        .socket
        .as_mut()
        .expect("bootstrap tunnel should hold an open websocket");
    set_tunnel_socket_nonblocking(socket)?;

    let mut telemetry_relay = TelemetryRelay::default();
    telemetry_relay
        .attach_tunnel_connection(socket)
        .map_err(|error| TunnelSessionError::AttachTelemetry(error.to_string()))?;
    runtime
        .keepalive_manager
        .lock()
        .expect("keepalive manager lock should not be poisoned")
        .on_tunnel_connected(runtime.clock.as_ref());
    runtime
        .runtime_readiness_manager
        .lock()
        .expect("runtime readiness manager lock should not be poisoned")
        .on_tunnel_connected();

    let mut agent_streams = BTreeMap::<u32, AgentStreamState>::new();
    let mut pty_sessions = BTreeMap::<String, PtySessionState>::new();
    let mut file_uploads = BTreeMap::<u32, FileUploadState>::new();
    let loop_context = TunnelSessionLoopContext {
        agent_endpoint_url: runtime.agent_endpoint_url.as_deref(),
        attachment_root: &runtime.attachment_root,
        cgroup_root: &runtime.cgroup_root,
        sandbox_instance_id: &runtime.sandbox_instance_id,
        clock: runtime.clock.as_ref(),
        sleeper: runtime.sleeper.as_ref(),
    };

    loop {
        if runtime.shutdown_requested.load(Ordering::Relaxed) {
            for pty_session in pty_sessions.values() {
                let _ = pty_session.session.terminate(
                    loop_context.clock,
                    loop_context.sleeper,
                    DEFAULT_PTY_TERMINATE_POLL_INTERVAL,
                    DEFAULT_PTY_TERMINATE_TIMEOUT_MS,
                );
            }
            let socket = tunnel
                .socket
                .as_mut()
                .expect("bootstrap tunnel should still hold a websocket while shutting down");
            let _ = telemetry_relay.detach_tunnel_connection(socket);
            runtime
                .keepalive_manager
                .lock()
                .expect("keepalive manager lock should not be poisoned")
                .on_tunnel_disconnected();
            runtime
                .runtime_readiness_manager
                .lock()
                .expect("runtime readiness manager lock should not be poisoned")
                .on_tunnel_disconnected();
            return tunnel
                .close()
                .map_err(|error| TunnelSessionError::WriteTunnelText(error.to_string()));
        }

        {
            let publishable_state = runtime
                .keepalive_manager
                .lock()
                .expect("keepalive manager lock should not be poisoned")
                .take_publishable_state(loop_context.clock);
            if let Some(state) = publishable_state {
                let payload =
                    serde_json::to_string(&state).map_err(TunnelSessionError::PublishKeepalive)?;
                tunnel
                    .send_text(&payload)
                    .map_err(|error| TunnelSessionError::WriteTunnelText(error.to_string()))?;
            }
        }
        {
            let publishable_state = runtime
                .runtime_readiness_manager
                .lock()
                .expect("runtime readiness manager lock should not be poisoned")
                .take_publishable_state();
            if let Some(state) = publishable_state {
                let payload = serde_json::to_string(&state)
                    .map_err(TunnelSessionError::PublishRuntimeReady)?;
                tunnel
                    .send_text(&payload)
                    .map_err(|error| TunnelSessionError::WriteTunnelText(error.to_string()))?;
            }
        }

        let socket = tunnel
            .socket
            .as_mut()
            .expect("bootstrap tunnel should hold an open websocket");
        let agent_work = poll_agent_streams(socket, &mut agent_streams);
        let pty_work = poll_pty_sessions(
            socket,
            &mut pty_sessions,
            loop_context.clock,
            loop_context.sleeper,
        );

        match socket.read() {
            Ok(Message::Text(payload)) => {
                if telemetry_relay
                    .handle_control_message(payload.as_str(), socket)
                    .map_err(|error| TunnelSessionError::HandleTelemetry(error.to_string()))?
                {
                    continue;
                }

                let control_message = parse_stream_control_message(payload.as_str())
                    .map_err(|error| TunnelSessionError::ParseControl(error.to_string()))?;
                handle_tunnel_control_message(
                    socket,
                    control_message,
                    &loop_context,
                    &mut agent_streams,
                    &mut pty_sessions,
                    &mut file_uploads,
                )?;
            }
            Ok(Message::Binary(payload)) => {
                let frame = decode_stream_data_frame(payload.as_ref())
                    .map_err(|error| TunnelSessionError::ParseDataFrame(error.to_string()))?;
                handle_tunnel_binary_frame(
                    socket,
                    frame,
                    &mut agent_streams,
                    &mut pty_sessions,
                    &mut file_uploads,
                )?;
            }
            Ok(Message::Ping(payload)) => {
                socket
                    .send(Message::Pong(payload))
                    .map_err(|error| TunnelSessionError::WriteTunnelText(error.to_string()))?;
            }
            Ok(Message::Pong(_)) | Ok(Message::Frame(_)) => {}
            Ok(Message::Close(_)) | Err(WebSocketError::ConnectionClosed) => {
                runtime
                    .keepalive_manager
                    .lock()
                    .expect("keepalive manager lock should not be poisoned")
                    .on_tunnel_disconnected();
                return Ok(());
            }
            Err(WebSocketError::Io(error)) if error.kind() == io::ErrorKind::WouldBlock => {
                if !agent_work && !pty_work {
                    runtime.sleeper.sleep(DEFAULT_TUNNEL_SESSION_POLL_INTERVAL);
                }
            }
            Err(error) => return Err(TunnelSessionError::ReadTunnel(error.to_string())),
        }
    }
}

fn poll_agent_streams(
    tunnel_socket: &mut WebSocket<MaybeTlsStream<TcpStream>>,
    agent_streams: &mut BTreeMap<u32, AgentStreamState>,
) -> bool {
    let stream_ids: Vec<u32> = agent_streams.keys().copied().collect();
    let mut did_work = false;
    let mut closed_stream_ids = Vec::new();

    for stream_id in stream_ids {
        let Some(agent_stream) = agent_streams.get_mut(&stream_id) else {
            continue;
        };

        loop {
            match agent_stream.runtime_socket.read() {
                Ok(Message::Text(payload)) => {
                    did_work = true;
                    if !agent_stream.send_window.try_consume(payload.len()) {
                        let _ = write_tunnel_text(
                            tunnel_socket,
                            stream_reset(
                                stream_id,
                                STREAM_RESET_CODE_STREAM_WINDOW_EXHAUSTED,
                                "agent stream send window is exhausted",
                            ),
                        );
                        closed_stream_ids.push(stream_id);
                        break;
                    }
                    let encoded = match encode_stream_data_frame(
                        stream_id,
                        PAYLOAD_KIND_WEBSOCKET_TEXT,
                        payload.as_bytes(),
                    ) {
                        Ok(encoded) => encoded,
                        Err(_) => {
                            closed_stream_ids.push(stream_id);
                            break;
                        }
                    };
                    if write_tunnel_binary(tunnel_socket, encoded).is_err() {
                        closed_stream_ids.push(stream_id);
                        break;
                    }
                }
                Ok(Message::Binary(payload)) => {
                    did_work = true;
                    if !agent_stream.send_window.try_consume(payload.len()) {
                        let _ = write_tunnel_text(
                            tunnel_socket,
                            stream_reset(
                                stream_id,
                                STREAM_RESET_CODE_STREAM_WINDOW_EXHAUSTED,
                                "agent stream send window is exhausted",
                            ),
                        );
                        closed_stream_ids.push(stream_id);
                        break;
                    }
                    let encoded = match encode_stream_data_frame(
                        stream_id,
                        PAYLOAD_KIND_WEBSOCKET_BINARY,
                        payload.as_ref(),
                    ) {
                        Ok(encoded) => encoded,
                        Err(_) => {
                            closed_stream_ids.push(stream_id);
                            break;
                        }
                    };
                    if write_tunnel_binary(tunnel_socket, encoded).is_err() {
                        closed_stream_ids.push(stream_id);
                        break;
                    }
                }
                Ok(Message::Ping(payload)) => {
                    did_work = true;
                    if agent_stream
                        .runtime_socket
                        .send(Message::Pong(payload))
                        .is_err()
                    {
                        closed_stream_ids.push(stream_id);
                        break;
                    }
                }
                Ok(Message::Pong(_)) | Ok(Message::Frame(_)) => {
                    did_work = true;
                }
                Ok(Message::Close(_)) | Err(WebSocketError::ConnectionClosed) => {
                    closed_stream_ids.push(stream_id);
                    break;
                }
                Err(WebSocketError::Io(error))
                    if matches!(
                        error.kind(),
                        io::ErrorKind::ConnectionReset
                            | io::ErrorKind::BrokenPipe
                            | io::ErrorKind::UnexpectedEof
                    ) =>
                {
                    closed_stream_ids.push(stream_id);
                    break;
                }
                Err(WebSocketError::Io(error)) if error.kind() == io::ErrorKind::WouldBlock => {
                    break;
                }
                Err(_) => {
                    closed_stream_ids.push(stream_id);
                    break;
                }
            }
        }
    }

    for stream_id in closed_stream_ids {
        agent_streams.remove(&stream_id);
    }

    did_work
}

fn poll_pty_sessions(
    tunnel_socket: &mut WebSocket<MaybeTlsStream<TcpStream>>,
    pty_sessions: &mut BTreeMap<String, PtySessionState>,
    clock: &dyn Clock,
    sleeper: &dyn Sleeper,
) -> bool {
    let session_ids: Vec<String> = pty_sessions.keys().cloned().collect();
    let mut did_work = false;
    let mut closed_session_ids = Vec::new();

    for session_id in session_ids {
        let Some(pty_state) = pty_sessions.get_mut(&session_id) else {
            continue;
        };

        loop {
            let next_event = match pty_state
                .session
                .next_event_timeout(Duration::from_millis(0))
            {
                Ok(event) => event,
                Err(_) => {
                    closed_session_ids.push(session_id.clone());
                    break;
                }
            };
            let Some(event) = next_event else {
                break;
            };
            did_work = true;
            match event {
                PtyEvent::Output(chunk) => {
                    let attached_stream_ids: Vec<u32> =
                        pty_state.attached_stream_ids.iter().copied().collect();
                    for stream_id in attached_stream_ids {
                        let Some(send_window) =
                            pty_state.send_windows_by_stream_id.get_mut(&stream_id)
                        else {
                            continue;
                        };
                        if !send_window.try_consume(chunk.len()) {
                            let _ = write_tunnel_text(
                                tunnel_socket,
                                stream_reset(
                                    stream_id,
                                    STREAM_RESET_CODE_STREAM_WINDOW_EXHAUSTED,
                                    "pty stream send window is exhausted",
                                ),
                            );
                            pty_state.attached_stream_ids.remove(&stream_id);
                            pty_state.send_windows_by_stream_id.remove(&stream_id);
                            if stream_id == pty_state.primary_stream_id {
                                let _ = pty_state.session.terminate(
                                    clock,
                                    sleeper,
                                    DEFAULT_PTY_TERMINATE_POLL_INTERVAL,
                                    DEFAULT_PTY_TERMINATE_TIMEOUT_MS,
                                );
                                closed_session_ids.push(session_id.clone());
                                break;
                            }
                            continue;
                        }

                        let encoded = match encode_stream_data_frame(
                            stream_id,
                            PAYLOAD_KIND_RAW_BYTES,
                            &chunk,
                        ) {
                            Ok(encoded) => encoded,
                            Err(_) => continue,
                        };
                        let _ = write_tunnel_binary(tunnel_socket, encoded);
                    }
                }
                PtyEvent::Exit(exit_code) => {
                    for stream_id in pty_state.attached_stream_ids.iter().copied() {
                        let _ =
                            write_tunnel_text(tunnel_socket, pty_exit_event(stream_id, exit_code));
                    }
                    closed_session_ids.push(session_id.clone());
                    break;
                }
                PtyEvent::Closed => {
                    if let Some(exit_code) = pty_state.session.exit_code() {
                        for stream_id in pty_state.attached_stream_ids.iter().copied() {
                            let _ = write_tunnel_text(
                                tunnel_socket,
                                pty_exit_event(stream_id, exit_code),
                            );
                        }
                        closed_session_ids.push(session_id.clone());
                        break;
                    }
                }
                PtyEvent::Error(message) => {
                    let _ = write_tunnel_text(
                        tunnel_socket,
                        stream_reset(
                            pty_state.primary_stream_id,
                            STREAM_RESET_CODE_TARGET_CLOSED,
                            message,
                        ),
                    );
                    closed_session_ids.push(session_id.clone());
                    break;
                }
            }
        }
    }

    for session_id in closed_session_ids {
        pty_sessions.remove(&session_id);
    }

    did_work
}

fn handle_tunnel_control_message(
    tunnel_socket: &mut WebSocket<MaybeTlsStream<TcpStream>>,
    control_message: StreamControlMessage,
    context: &TunnelSessionLoopContext<'_>,
    agent_streams: &mut BTreeMap<u32, AgentStreamState>,
    pty_sessions: &mut BTreeMap<String, PtySessionState>,
    file_uploads: &mut BTreeMap<u32, FileUploadState>,
) -> Result<(), TunnelSessionError> {
    match control_message {
        StreamControlMessage::OpenAgent(message) => {
            let Some(runtime_endpoint_url) = context.agent_endpoint_url else {
                write_tunnel_text(
                    tunnel_socket,
                    stream_open_error(
                        message.stream_id,
                        CONNECT_ERROR_CODE_AGENT_ENDPOINT_DIAL_FAILED,
                        "agent runtime endpoint is not available",
                    ),
                )?;
                return Ok(());
            };

            let (mut runtime_socket, _) = connect(runtime_endpoint_url)
                .map_err(|error| TunnelSessionError::AgentDial(error.to_string()))?;
            set_agent_socket_nonblocking(&mut runtime_socket)?;
            agent_streams.insert(
                message.stream_id,
                AgentStreamState {
                    runtime_socket,
                    send_window: StreamSendWindow::default(),
                },
            );
            write_tunnel_text(tunnel_socket, stream_open_ok(message.stream_id))?;
        }
        StreamControlMessage::OpenPty(message) => {
            handle_pty_open(
                tunnel_socket,
                message,
                context.cgroup_root,
                context.sandbox_instance_id,
                pty_sessions,
                context.clock,
                context.sleeper,
            )?;
        }
        StreamControlMessage::OpenFileUpload(message) => {
            let upload_state =
                create_file_upload_state(&message, context.attachment_root, context.clock)
                    .map_err(TunnelSessionError::FileUpload)?;
            file_uploads.insert(message.stream_id, upload_state);
            write_tunnel_text(tunnel_socket, stream_open_ok(message.stream_id))?;
        }
        StreamControlMessage::Signal(message) => {
            let Some(pty_state) = pty_sessions
                .values_mut()
                .find(|pty_state| pty_state.attached_stream_ids.contains(&message.stream_id))
            else {
                write_tunnel_text(
                    tunnel_socket,
                    stream_reset(
                        message.stream_id,
                        STREAM_RESET_CODE_INVALID_STREAM_SIGNAL,
                        format!(
                            "stream signal streamId {} is not attached to an active PTY session",
                            message.stream_id
                        ),
                    ),
                )?;
                return Ok(());
            };

            pty_state
                .session
                .resize(message.signal.cols, message.signal.rows)
                .map_err(|error| TunnelSessionError::Pty(error.to_string()))?;
        }
        StreamControlMessage::Close(message) => {
            if let Some(agent_stream) = agent_streams.remove(&message.stream_id) {
                let mut runtime_socket = agent_stream.runtime_socket;
                let _ = runtime_socket.close(None);
                return Ok(());
            }
            if let Some(pty_session_id) = pty_sessions
                .iter()
                .find(|(_, pty_state)| pty_state.attached_stream_ids.contains(&message.stream_id))
                .map(|(session_id, _)| session_id.clone())
            {
                handle_pty_close(
                    tunnel_socket,
                    &pty_session_id,
                    message.stream_id,
                    pty_sessions,
                    context.clock,
                    context.sleeper,
                )?;
                return Ok(());
            }
            if let Some(upload_state) = file_uploads.remove(&message.stream_id) {
                finalize_file_upload(tunnel_socket, message.stream_id, upload_state)?;
                return Ok(());
            }

            write_tunnel_text(
                tunnel_socket,
                stream_reset(
                    message.stream_id,
                    STREAM_RESET_CODE_INVALID_STREAM_CLOSE,
                    format!(
                        "stream.close streamId {} is not bound to an active tunnel stream",
                        message.stream_id
                    ),
                ),
            )?;
        }
        StreamControlMessage::Window(message) => {
            if let Some(agent_stream) = agent_streams.get_mut(&message.stream_id) {
                agent_stream
                    .send_window
                    .add(message.bytes)
                    .map_err(|error| TunnelSessionError::ParseControl(error.to_string()))?;
                return Ok(());
            }
            if let Some(pty_state) = pty_sessions
                .values_mut()
                .find(|pty_state| pty_state.attached_stream_ids.contains(&message.stream_id))
            {
                let Some(send_window) = pty_state
                    .send_windows_by_stream_id
                    .get_mut(&message.stream_id)
                else {
                    return Ok(());
                };
                send_window
                    .add(message.bytes)
                    .map_err(|error| TunnelSessionError::ParseControl(error.to_string()))?;
                return Ok(());
            }

            write_tunnel_text(
                tunnel_socket,
                stream_reset(
                    message.stream_id,
                    STREAM_RESET_CODE_INVALID_STREAM_WINDOW,
                    format!(
                        "stream.window streamId {} is not bound to an active tunnel stream",
                        message.stream_id
                    ),
                ),
            )?;
        }
    }

    Ok(())
}

fn handle_tunnel_binary_frame(
    tunnel_socket: &mut WebSocket<MaybeTlsStream<TcpStream>>,
    frame: crate::tunnel::protocol::StreamDataFrame,
    agent_streams: &mut BTreeMap<u32, AgentStreamState>,
    pty_sessions: &mut BTreeMap<String, PtySessionState>,
    file_uploads: &mut BTreeMap<u32, FileUploadState>,
) -> Result<(), TunnelSessionError> {
    if let Some(agent_stream) = agent_streams.get_mut(&frame.stream_id) {
        match frame.payload_kind {
            PAYLOAD_KIND_WEBSOCKET_TEXT => {
                let payload = String::from_utf8(frame.payload)
                    .map_err(|error| TunnelSessionError::AgentWrite(error.to_string()))?;
                agent_stream
                    .runtime_socket
                    .send(Message::Text(payload.into()))
                    .map_err(|error| TunnelSessionError::AgentWrite(error.to_string()))?;
            }
            PAYLOAD_KIND_WEBSOCKET_BINARY => {
                agent_stream
                    .runtime_socket
                    .send(Message::Binary(frame.payload.into()))
                    .map_err(|error| TunnelSessionError::AgentWrite(error.to_string()))?;
            }
            _ => {
                write_tunnel_text(
                    tunnel_socket,
                    stream_reset(
                        frame.stream_id,
                        STREAM_RESET_CODE_INVALID_STREAM_DATA,
                        "agent stream only accepts websocket text or binary payload kinds",
                    ),
                )?;
            }
        }
        return Ok(());
    }

    if let Some(pty_state) = pty_sessions
        .values_mut()
        .find(|pty_state| pty_state.attached_stream_ids.contains(&frame.stream_id))
    {
        if frame.payload_kind != PAYLOAD_KIND_RAW_BYTES {
            write_tunnel_text(
                tunnel_socket,
                stream_reset(
                    frame.stream_id,
                    STREAM_RESET_CODE_INVALID_STREAM_DATA,
                    "pty stream only accepts raw byte data frames",
                ),
            )?;
            return Ok(());
        }

        pty_state
            .session
            .write(&frame.payload)
            .map_err(|error| TunnelSessionError::Pty(error.to_string()))?;
        write_tunnel_text(
            tunnel_socket,
            stream_window(frame.stream_id, frame.payload.len()),
        )?;
        return Ok(());
    }

    if let Some(upload_state) = file_uploads.get_mut(&frame.stream_id) {
        if frame.payload_kind != PAYLOAD_KIND_RAW_BYTES {
            write_tunnel_text(
                tunnel_socket,
                stream_reset(
                    frame.stream_id,
                    STREAM_RESET_CODE_INVALID_STREAM_DATA,
                    "file upload stream only accepts raw byte payloads",
                ),
            )?;
            return Ok(());
        }

        upload_state.received_bytes = upload_state
            .received_bytes
            .saturating_add(frame.payload.len());
        if upload_state.received_bytes > upload_state.size_bytes {
            write_tunnel_text(
                tunnel_socket,
                stream_reset(
                    frame.stream_id,
                    FILE_UPLOAD_RESET_CODE_BYTE_COUNT_EXCEEDED,
                    "received more bytes than declared by the upload metadata",
                ),
            )?;
            file_uploads.remove(&frame.stream_id);
            return Ok(());
        }

        upload_state
            .file
            .write_all(&frame.payload)
            .map_err(|error| TunnelSessionError::FileUpload(error.to_string()))?;
        write_tunnel_text(
            tunnel_socket,
            stream_window(frame.stream_id, frame.payload.len()),
        )?;
        return Ok(());
    }

    write_tunnel_text(
        tunnel_socket,
        stream_reset(
            frame.stream_id,
            STREAM_RESET_CODE_INVALID_STREAM_DATA,
            format!(
                "stream data frame streamId {} is not bound to an active tunnel stream",
                frame.stream_id
            ),
        ),
    )?;
    Ok(())
}

fn handle_pty_open(
    tunnel_socket: &mut WebSocket<MaybeTlsStream<TcpStream>>,
    message: crate::tunnel::protocol::PtyStreamOpen,
    cgroup_root: &Path,
    sandbox_instance_id: &str,
    pty_sessions: &mut BTreeMap<String, PtySessionState>,
    clock: &dyn Clock,
    sleeper: &dyn Sleeper,
) -> Result<(), TunnelSessionError> {
    match message.channel.session {
        crate::tunnel::protocol::PtySessionMode::Attach => {
            let Some(pty_state) = pty_sessions.get_mut(&message.channel.pty_session_id) else {
                write_tunnel_text(
                    tunnel_socket,
                    stream_open_error(
                        message.stream_id,
                        CONNECT_ERROR_CODE_PTY_SESSION_UNAVAILABLE,
                        "pty session is not available",
                    ),
                )?;
                return Ok(());
            };

            pty_state.attached_stream_ids.insert(message.stream_id);
            pty_state
                .send_windows_by_stream_id
                .insert(message.stream_id, StreamSendWindow::default());
            write_tunnel_text(tunnel_socket, stream_open_ok(message.stream_id))?;
        }
        crate::tunnel::protocol::PtySessionMode::Create => {
            if pty_sessions.contains_key(&message.channel.pty_session_id) {
                write_tunnel_text(
                    tunnel_socket,
                    stream_open_error(
                        message.stream_id,
                        CONNECT_ERROR_CODE_PTY_SESSION_EXISTS,
                        "pty session already exists",
                    ),
                )?;
                return Ok(());
            }

            let session = match start_scoped_pty_session(
                PtySpawnRequest {
                    cwd: message.channel.cwd.clone(),
                    cols: message.channel.cols,
                    rows: message.channel.rows,
                    command: message.channel.command.clone(),
                    args: message.channel.args.clone(),
                },
                cgroup_root,
                sandbox_instance_id,
                clock,
                sleeper,
            ) {
                Ok(session) => session,
                Err(error) => {
                    write_tunnel_text(
                        tunnel_socket,
                        stream_open_error(
                            message.stream_id,
                            CONNECT_ERROR_CODE_PTY_SESSION_CREATE_FAILED,
                            error.to_string(),
                        ),
                    )?;
                    return Ok(());
                }
            };

            let mut attached_stream_ids = BTreeSet::new();
            attached_stream_ids.insert(message.stream_id);
            let mut send_windows_by_stream_id = BTreeMap::new();
            send_windows_by_stream_id.insert(message.stream_id, StreamSendWindow::default());
            pty_sessions.insert(
                message.channel.pty_session_id.clone(),
                PtySessionState {
                    session,
                    primary_stream_id: message.stream_id,
                    attached_stream_ids,
                    send_windows_by_stream_id,
                },
            );
            write_tunnel_text(tunnel_socket, stream_open_ok(message.stream_id))?;
        }
    }

    Ok(())
}

fn handle_pty_close(
    tunnel_socket: &mut WebSocket<MaybeTlsStream<TcpStream>>,
    pty_session_id: &str,
    stream_id: u32,
    pty_sessions: &mut BTreeMap<String, PtySessionState>,
    clock: &dyn Clock,
    sleeper: &dyn Sleeper,
) -> Result<(), TunnelSessionError> {
    let Some(pty_state) = pty_sessions.get_mut(pty_session_id) else {
        return Ok(());
    };

    if !pty_state.attached_stream_ids.contains(&stream_id) {
        write_tunnel_text(
            tunnel_socket,
            stream_reset(
                stream_id,
                STREAM_RESET_CODE_INVALID_STREAM_CLOSE,
                format!(
                    "stream close streamId {} is not attached to the active PTY session",
                    stream_id
                ),
            ),
        )?;
        return Ok(());
    }

    if stream_id != pty_state.primary_stream_id {
        pty_state.attached_stream_ids.remove(&stream_id);
        pty_state.send_windows_by_stream_id.remove(&stream_id);
        return Ok(());
    }

    match pty_state.session.terminate(
        clock,
        sleeper,
        DEFAULT_PTY_TERMINATE_POLL_INTERVAL,
        DEFAULT_PTY_TERMINATE_TIMEOUT_MS,
    ) {
        Ok(exit_code) => {
            for attached_stream_id in pty_state.attached_stream_ids.iter().copied() {
                write_tunnel_text(tunnel_socket, pty_exit_event(attached_stream_id, exit_code))?;
            }
            pty_sessions.remove(pty_session_id);
        }
        Err(error) => {
            write_tunnel_text(
                tunnel_socket,
                stream_reset(
                    pty_state.primary_stream_id,
                    STREAM_RESET_CODE_STREAM_CLOSE_FAILED,
                    error.to_string(),
                ),
            )?;
            pty_sessions.remove(pty_session_id);
        }
    }

    Ok(())
}

fn create_file_upload_state(
    message: &crate::tunnel::protocol::FileUploadStreamOpen,
    attachment_root: &Path,
    clock: &dyn Clock,
) -> Result<FileUploadState, String> {
    assert_upload_metadata(
        &message.channel.thread_id,
        &message.channel.mime_type,
        message.channel.size_bytes,
    )?;
    let thread_directory_path =
        derive_upload_thread_directory_path(attachment_root, &message.channel.thread_id)?;
    fs::create_dir_all(&thread_directory_path).map_err(|error| {
        format!(
            "failed to create upload thread directory {}: {error}",
            thread_directory_path.display()
        )
    })?;

    let attachment_id = format!(
        "att_{}_{}",
        clock.now_ms(),
        UPLOAD_ID_COUNTER.fetch_add(1, Ordering::Relaxed)
    );
    let extension = resolve_image_extension(&message.channel.mime_type)?;
    let temp_path = thread_directory_path.join(format!(".{attachment_id}.part"));
    let final_path = thread_directory_path.join(format!("{attachment_id}.{extension}"));
    let file = OpenOptions::new()
        .create_new(true)
        .write(true)
        .open(&temp_path)
        .map_err(|error| {
            format!(
                "failed to create temporary upload file {}: {error}",
                temp_path.display()
            )
        })?;

    Ok(FileUploadState {
        thread_id: message.channel.thread_id.clone(),
        mime_type: message.channel.mime_type.clone(),
        original_filename: message.channel.original_filename.clone(),
        size_bytes: message.channel.size_bytes,
        temp_path,
        final_path,
        file,
        received_bytes: 0,
    })
}

fn finalize_file_upload(
    tunnel_socket: &mut WebSocket<MaybeTlsStream<TcpStream>>,
    stream_id: u32,
    upload_state: FileUploadState,
) -> Result<(), TunnelSessionError> {
    if upload_state.received_bytes != upload_state.size_bytes {
        write_tunnel_text(
            tunnel_socket,
            stream_reset(
                stream_id,
                FILE_UPLOAD_RESET_CODE_BYTE_COUNT_MISMATCH,
                "uploaded byte count did not match declared size",
            ),
        )?;
        let _ = fs::remove_file(&upload_state.temp_path);
        return Ok(());
    }

    upload_state
        .file
        .sync_all()
        .map_err(|error| TunnelSessionError::FileUpload(error.to_string()))?;
    match validate_uploaded_image(
        &upload_state.mime_type,
        &upload_state.temp_path,
        &upload_state.final_path,
    ) {
        Ok(()) => {}
        Err((code, message)) => {
            write_tunnel_text(tunnel_socket, stream_reset(stream_id, code, message))?;
            let _ = fs::remove_file(&upload_state.temp_path);
            return Ok(());
        }
    }

    fs::rename(&upload_state.temp_path, &upload_state.final_path)
        .map_err(|error| TunnelSessionError::FileUpload(error.to_string()))?;
    let attachment_id = upload_state
        .final_path
        .file_stem()
        .and_then(|value| value.to_str())
        .unwrap_or("attachment");
    let final_path_text = upload_state.final_path.to_string_lossy();
    write_tunnel_text(
        tunnel_socket,
        file_upload_completed_event(
            stream_id,
            attachment_id,
            &upload_state.thread_id,
            &upload_state.original_filename,
            &upload_state.mime_type,
            upload_state.size_bytes,
            &final_path_text,
        ),
    )?;
    write_tunnel_text(tunnel_socket, stream_complete(stream_id))?;

    Ok(())
}

fn derive_sandbox_instance_id(gateway_ws_url: &str) -> Result<String, TunnelSessionError> {
    let parsed_url = Url::parse(gateway_ws_url)
        .map_err(|error| TunnelSessionError::InvalidGatewayUrl(error.to_string()))?;
    let Some(segment) = parsed_url
        .path_segments()
        .and_then(|mut segments| segments.rfind(|segment| !segment.is_empty()))
    else {
        return Err(TunnelSessionError::InvalidGatewayUrl(
            "tunnel gateway url must end with the sandbox instance id path segment".to_string(),
        ));
    };

    Ok(segment.to_string())
}

fn set_tunnel_socket_nonblocking(
    socket: &mut WebSocket<MaybeTlsStream<TcpStream>>,
) -> Result<(), TunnelSessionError> {
    match socket.get_mut() {
        MaybeTlsStream::Plain(stream) => stream
            .set_nonblocking(true)
            .map_err(|error| TunnelSessionError::ConfigureTunnelSocket(error.to_string())),
        _ => Err(TunnelSessionError::ConfigureTunnelSocket(
            "bootstrap tunnel transport is not supported by sandboxd".to_string(),
        )),
    }
}

fn set_agent_socket_nonblocking(
    socket: &mut WebSocket<MaybeTlsStream<TcpStream>>,
) -> Result<(), TunnelSessionError> {
    match socket.get_mut() {
        MaybeTlsStream::Plain(stream) => stream
            .set_nonblocking(true)
            .map_err(|error| TunnelSessionError::AgentSocket(error.to_string())),
        _ => Err(TunnelSessionError::AgentSocket(
            "agent runtime endpoints must use plain ws transports".to_string(),
        )),
    }
}

fn write_tunnel_text(
    socket: &mut WebSocket<MaybeTlsStream<TcpStream>>,
    payload: String,
) -> Result<(), TunnelSessionError> {
    socket
        .send(Message::Text(payload.into()))
        .map_err(|error| TunnelSessionError::WriteTunnelText(error.to_string()))
}

fn write_tunnel_binary(
    socket: &mut WebSocket<MaybeTlsStream<TcpStream>>,
    payload: Vec<u8>,
) -> Result<(), TunnelSessionError> {
    socket
        .send(Message::Binary(payload.into()))
        .map_err(|error| TunnelSessionError::WriteTunnelBinary(error.to_string()))
}

fn assert_upload_metadata(
    thread_id: &str,
    mime_type: &str,
    size_bytes: usize,
) -> Result<(), String> {
    assert_safe_upload_thread_id(thread_id)?;
    if mime_type.trim().is_empty() {
        return Err("mimeType is required.".to_string());
    }
    if size_bytes == 0 {
        return Err("sizeBytes must be greater than 0.".to_string());
    }
    if size_bytes > MAX_UPLOAD_SIZE_BYTES {
        return Err("sizeBytes exceeds the configured upload limit.".to_string());
    }
    resolve_image_extension(mime_type)?;
    Ok(())
}

fn resolve_image_extension(mime_type: &str) -> Result<&'static str, String> {
    match mime_type {
        "image/png" => Ok("png"),
        "image/jpeg" => Ok("jpg"),
        "image/webp" => Ok("webp"),
        "image/gif" => Ok("gif"),
        _ => Err(format!("Unsupported image MIME type '{mime_type}'.")),
    }
}

fn assert_safe_upload_thread_id(thread_id: &str) -> Result<(), String> {
    let trimmed_thread_id = thread_id.trim();
    if trimmed_thread_id.is_empty() {
        return Err("threadId is required.".to_string());
    }
    if trimmed_thread_id != thread_id {
        return Err("threadId must not include leading or trailing whitespace.".to_string());
    }
    if thread_id.len() > MAX_UPLOAD_THREAD_ID_LENGTH {
        return Err("threadId exceeds the configured length limit.".to_string());
    }
    if !thread_id
        .bytes()
        .all(|byte| byte.is_ascii_alphanumeric() || byte == b'_' || byte == b'-')
    {
        return Err("threadId must use only ASCII letters, digits, '_' or '-'.".to_string());
    }
    Ok(())
}

fn derive_upload_thread_directory_path(
    attachment_root_path: &Path,
    thread_id: &str,
) -> Result<PathBuf, String> {
    assert_safe_upload_thread_id(thread_id)?;
    Ok(attachment_root_path.join(thread_id))
}

fn validate_uploaded_image(
    declared_mime_type: &str,
    temp_path: &Path,
    final_path: &Path,
) -> Result<(), (&'static str, String)> {
    let mut file = File::open(temp_path).map_err(|error| {
        (
            FILE_UPLOAD_RESET_CODE_INVALID_FILE_TYPE,
            format!(
                "failed to open temporary upload file {}: {error}",
                temp_path.display()
            ),
        )
    })?;
    let mut signature_bytes = [0_u8; 12];
    let bytes_read = file.read(&mut signature_bytes).map_err(|error| {
        (
            FILE_UPLOAD_RESET_CODE_INVALID_FILE_TYPE,
            format!(
                "failed to read upload signature from {}: {error}",
                temp_path.display()
            ),
        )
    })?;
    let detected_mime_type = detect_supported_image_mime_type(&signature_bytes[..bytes_read]);
    let Some(detected_mime_type) = detected_mime_type else {
        return Err((
            FILE_UPLOAD_RESET_CODE_INVALID_FILE_TYPE,
            "uploaded file is not a supported image".to_string(),
        ));
    };
    if detected_mime_type != declared_mime_type {
        return Err((
            FILE_UPLOAD_RESET_CODE_MIME_TYPE_MISMATCH,
            format!(
                "uploaded file content is '{detected_mime_type}', which does not match declared MIME type '{declared_mime_type}'"
            ),
        ));
    }
    if final_path.parent().is_none() {
        return Err((
            FILE_UPLOAD_RESET_CODE_INVALID_FILE_TYPE,
            "final upload path must include a parent directory".to_string(),
        ));
    }
    Ok(())
}

fn detect_supported_image_mime_type(bytes: &[u8]) -> Option<&'static str> {
    if matches_signature(bytes, 0, PNG_SIGNATURE) {
        return Some("image/png");
    }
    if matches_signature(bytes, 0, JPEG_SIGNATURE) {
        return Some("image/jpeg");
    }
    if matches_signature(bytes, 0, GIF87A_SIGNATURE)
        || matches_signature(bytes, 0, GIF89A_SIGNATURE)
    {
        return Some("image/gif");
    }
    if matches_signature(bytes, 0, WEBP_RIFF_SIGNATURE)
        && matches_signature(bytes, 8, WEBP_BRAND_SIGNATURE)
    {
        return Some("image/webp");
    }
    None
}

fn matches_signature(bytes: &[u8], offset: usize, signature: &[u8]) -> bool {
    if bytes.len() < offset.saturating_add(signature.len()) {
        return false;
    }

    signature
        .iter()
        .enumerate()
        .all(|(index, value)| bytes[offset + index] == *value)
}

#[cfg(test)]
mod tests {
    use std::collections::BTreeMap;
    use std::fs;
    use std::net::TcpListener;
    use std::path::PathBuf;
    use std::sync::atomic::{AtomicU64, Ordering};
    use std::sync::{Arc, Mutex, mpsc};
    use std::thread;

    use serde_json::{Value, json};
    use tungstenite::{Error as WebSocketError, Message, WebSocket, accept};

    use crate::keepalive::KeepaliveManager;
    use crate::protocol::startup::{StartupInput, StartupMode};
    use crate::runtime::adapters::RuntimeAdapterRegistry;
    use crate::runtime::readiness::RuntimeReadinessManager;
    use crate::time::{SystemClock, ThreadSleeper};
    use crate::tunnel::connect_bootstrap_tunnel;
    use crate::tunnel::protocol::{
        PAYLOAD_KIND_RAW_BYTES, PAYLOAD_KIND_WEBSOCKET_TEXT, decode_stream_data_frame,
        encode_stream_data_frame,
    };
    use crate::tunnel::session::TunnelSession;

    static REQUEST_ID_COUNTER: AtomicU64 = AtomicU64::new(900);
    #[test]
    fn starts_live_tunnel_session_for_agent_and_file_upload_streams() {
        let upload_thread_id = format!(
            "thread_{}",
            REQUEST_ID_COUNTER.fetch_add(1, Ordering::Relaxed)
        );

        let raw_listener = TcpListener::bind("127.0.0.1:0").expect("raw listener should bind");
        let raw_url = format!(
            "ws://127.0.0.1:{}/raw",
            raw_listener
                .local_addr()
                .expect("raw listener should expose an address")
                .port()
        );
        let raw_server_thread = thread::spawn(move || {
            let (monitor_stream, _) = raw_listener
                .accept()
                .expect("raw app-server should accept the monitor connection");
            let mut monitor_socket =
                accept(monitor_stream).expect("monitor handshake should succeed");

            assert_eq!(
                read_json_text_message(&mut monitor_socket)["method"],
                Value::String("initialize".to_string())
            );
            monitor_socket
                .send(Message::Text(
                    json!({
                        "id": 1,
                        "result": {
                            "userAgent": "codex-app-server",
                            "codexHome": "/tmp/codex-home",
                            "platformFamily": "linux",
                            "platformOs": "linux"
                        }
                    })
                    .to_string()
                    .into(),
                ))
                .expect("initialize response should send");
            assert_eq!(
                read_json_text_message(&mut monitor_socket)["method"],
                Value::String("initialized".to_string())
            );

            let thread_loaded_list_request = read_json_text_message(&mut monitor_socket);
            assert_eq!(
                thread_loaded_list_request["method"],
                Value::String("thread/loaded/list".to_string())
            );
            monitor_socket
                .send(Message::Text(
                    json!({
                        "id": thread_loaded_list_request["id"],
                        "result": {
                            "data": [],
                            "nextCursor": null
                        }
                    })
                    .to_string()
                    .into(),
                ))
                .expect("thread/loaded/list response should send");

            let (client_stream, _) = raw_listener
                .accept()
                .expect("raw app-server should accept the proxied client connection");
            let mut client_socket =
                accept(client_stream).expect("proxied client handshake should succeed");
            let proxied_request = read_json_text_message(&mut client_socket);
            client_socket
                .send(Message::Text(
                    json!({
                        "id": proxied_request["id"],
                        "result": {
                            "data": []
                        }
                    })
                    .to_string()
                    .into(),
                ))
                .expect("proxied response should send");
            match client_socket.read() {
                Ok(Message::Close(_)) | Err(WebSocketError::ConnectionClosed) => {}
                Ok(other_message) => panic!(
                    "expected proxied client websocket to close after tunnel stream shutdown, got {other_message:?}"
                ),
                Err(error) => panic!(
                    "proxied client websocket should only end because the tunnel stream closed: {error}"
                ),
            }
        });

        let bootstrap_listener =
            TcpListener::bind("127.0.0.1:0").expect("bootstrap listener should bind");
        let bootstrap_url = format!(
            "ws://127.0.0.1:{}/tunnel/sandbox/sbi_tunnel_session",
            bootstrap_listener
                .local_addr()
                .expect("bootstrap listener should expose an address")
                .port()
        );
        let (gateway_done_sender, gateway_done_receiver) = mpsc::channel();
        let upload_thread_id_for_gateway = upload_thread_id.clone();
        let gateway_thread = thread::spawn(move || {
            let (stream, _) = bootstrap_listener
                .accept()
                .expect("gateway should accept the bootstrap tunnel");
            let mut websocket = accept(stream).expect("gateway websocket handshake should succeed");

            let telemetry_open = read_json_text_message(&mut websocket);
            assert_eq!(telemetry_open["type"], "telemetry.open");
            websocket
                .send(Message::Text(
                    json!({
                        "type": "telemetry.open.ok",
                        "streamId": telemetry_open["streamId"],
                        "initialWindowBytes": 1024
                    })
                    .to_string()
                    .into(),
                ))
                .expect("gateway should acknowledge telemetry.open");

            let mut saw_keepalive = false;
            let mut saw_runtime_ready = false;
            while !saw_keepalive || !saw_runtime_ready {
                let control_message = read_json_text_message(&mut websocket);
                match control_message["type"].as_str() {
                    Some("keepalive.state") => {
                        assert_eq!(control_message["active"], Value::Bool(false));
                        saw_keepalive = true;
                    }
                    Some("runtime.ready") => {
                        if control_message["ready"] == Value::Bool(true) {
                            saw_runtime_ready = true;
                        }
                    }
                    other => panic!("unexpected bootstrap control message before streams: {other:?}"),
                }
            }

            websocket
                .send(Message::Text(
                    json!({
                        "type": "stream.open",
                        "streamId": 7,
                        "channel": {
                            "kind": "agent"
                        }
                    })
                    .to_string()
                    .into(),
                ))
                .expect("gateway should open an agent stream");
            assert_eq!(
                read_stream_text_message(&mut websocket),
                json!({
                    "type": "stream.open.ok",
                    "streamId": 7
                })
            );

            let request_id = REQUEST_ID_COUNTER.fetch_add(1, Ordering::Relaxed);
            let encoded_request = encode_stream_data_frame(
                7,
                PAYLOAD_KIND_WEBSOCKET_TEXT,
                json!({
                    "id": request_id,
                    "method": "thread/loaded/list",
                    "params": {}
                })
                .to_string()
                .as_bytes(),
            )
            .expect("agent request frame should encode");
            websocket
                .send(Message::Binary(encoded_request.into()))
                .expect("gateway should send agent request data");

            let agent_response = read_binary_frame(&mut websocket);
            assert_eq!(agent_response.stream_id, 7);
            assert_eq!(agent_response.payload_kind, PAYLOAD_KIND_WEBSOCKET_TEXT);
            assert_eq!(
                serde_json::from_slice::<Value>(&agent_response.payload)
                    .expect("agent response should be json"),
                json!({
                    "id": request_id,
                    "result": {
                        "data": []
                    }
                })
            );

            websocket
                .send(Message::Text(
                    json!({
                        "type": "stream.close",
                        "streamId": 7
                    })
                    .to_string()
                    .into(),
                ))
                .expect("gateway should close the agent stream");

            websocket
                .send(Message::Text(
                    json!({
                        "type": "stream.open",
                        "streamId": 9,
                        "channel": {
                            "kind": "fileUpload",
                            "threadId": upload_thread_id_for_gateway,
                            "mimeType": "image/png",
                            "originalFilename": "image.png",
                            "sizeBytes": 8
                        }
                    })
                    .to_string()
                    .into(),
                ))
                .expect("gateway should open a file upload stream");
            assert_eq!(
                read_stream_text_message(&mut websocket),
                json!({
                    "type": "stream.open.ok",
                    "streamId": 9
                })
            );

            let png_bytes = vec![0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
            let encoded_upload = encode_stream_data_frame(9, PAYLOAD_KIND_RAW_BYTES, &png_bytes)
                .expect("file upload frame should encode");
            websocket
                .send(Message::Binary(encoded_upload.into()))
                .expect("gateway should send file upload bytes");

            let upload_window = read_stream_text_message(&mut websocket);
            assert_eq!(upload_window["type"], "stream.window");
            assert_eq!(upload_window["streamId"], Value::Number(9.into()));
            assert_eq!(upload_window["bytes"], Value::Number(8.into()));

            websocket
                .send(Message::Text(
                    json!({
                        "type": "stream.close",
                        "streamId": 9
                    })
                    .to_string()
                    .into(),
                ))
                .expect("gateway should close the file upload stream");

            let completion_event = read_stream_text_message(&mut websocket);
            assert_eq!(completion_event["type"], "stream.event");
            assert_eq!(completion_event["streamId"], Value::Number(9.into()));
            assert_eq!(completion_event["event"]["type"], "fileUpload.completed");
            let persisted_path = completion_event["event"]["path"]
                .as_str()
                .expect("file upload completed event should expose a persisted path")
                .to_string();
            assert_eq!(
                fs::read(&persisted_path).expect("persisted upload should be readable"),
                png_bytes
            );

            let complete_message = read_stream_text_message(&mut websocket);
            assert_eq!(complete_message["type"], "stream.complete");
            assert_eq!(complete_message["streamId"], Value::Number(9.into()));

            websocket
                .close(None)
                .expect("gateway websocket should close cleanly");
            gateway_done_sender
                .send(persisted_path)
                .expect("gateway should report the persisted path");
        });

        let startup_input = StartupInput {
            startup_mode: StartupMode::New,
            bootstrap_token: "bootstrap-token-value".to_string(),
            tunnel_exchange_token: "tunnel-exchange-token-value".to_string(),
            tunnel_gateway_ws_url: bootstrap_url,
            runtime_plan: serde_json::json!({
                "sandboxProfileId": "sbp_123",
                "version": 1,
                "image": {
                    "source": "base",
                    "imageRef": "mistle/sandbox-base:dev"
                },
                "egressRoutes": [],
                "artifacts": [],
                "workspaceSources": [],
                "runtimeClients": [
                    {
                        "clientId": "codex-cli",
                        "setup": {
                            "env": {},
                            "files": []
                        },
                        "processes": [
                            {
                                "processKey": "codex-app-server",
                                "command": {
                                    "args": ["/bin/sh", "-lc", "sleep 30"]
                                },
                                "readiness": {
                                    "type": "ws",
                                    "url": raw_url,
                                    "timeoutMs": 5000
                                },
                                "stop": {
                                    "signal": "sigterm",
                                    "timeoutMs": 10000,
                                    "gracePeriodMs": 2000
                                }
                            }
                        ],
                        "endpoints": [
                            {
                                "endpointKey": "app-server",
                                "processKey": null,
                                "transport": {
                                    "type": "ws",
                                    "url": "ws://127.0.0.1:0/codex"
                                },
                                "connectionMode": "dedicated"
                            }
                        ]
                    }
                ],
                "agentRuntimes": [
                    {
                        "bindingId": "arb_123",
                        "runtimeId": "codex",
                        "runtimeKey": "codex-app-server",
                        "clientId": "codex-cli",
                        "endpointKey": "app-server",
                        "ptyLaunch": {
                            "runtimeId": "codex",
                            "displayName": "Codex",
                            "newLaunch": {
                                "ptySessionId": "pty_new",
                                "cols": 80,
                                "rows": 24,
                                "command": "codex",
                                "args": []
                            },
                            "resumeLaunch": {
                                "ptySessionId": "pty_resume",
                                "cols": 80,
                                "rows": 24,
                                "command": "codex",
                                "args": []
                            }
                        }
                    }
                ]
            }),
            egress_grant_by_rule_id: BTreeMap::new(),
        };

        let keepalive_manager = Arc::new(Mutex::new(KeepaliveManager::default()));
        let runtime_readiness_manager = Arc::new(Mutex::new(RuntimeReadinessManager::default()));
        let runtime_adapters = RuntimeAdapterRegistry
            .start(
                &startup_input,
                keepalive_manager.clone(),
                runtime_readiness_manager.clone(),
                Arc::new(ThreadSleeper),
            )
            .expect("runtime adapters should start");
        let tunnel = connect_bootstrap_tunnel(
            &startup_input.tunnel_gateway_ws_url,
            &startup_input.bootstrap_token,
        )
        .expect("bootstrap tunnel should connect");
        let tunnel_session = TunnelSession::start(
            &startup_input,
            tunnel,
            keepalive_manager,
            runtime_readiness_manager,
            Some(runtime_adapters.adapters()[0].listen_url().to_string()),
            Arc::new(SystemClock),
            Arc::new(ThreadSleeper),
        )
        .expect("tunnel session should start");

        let persisted_path = gateway_done_receiver
            .recv()
            .expect("gateway should complete the live tunnel interaction");

        tunnel_session
            .close()
            .expect("tunnel session should stop cleanly");
        runtime_adapters
            .close()
            .expect("runtime adapters should stop cleanly");
        gateway_thread
            .join()
            .expect("gateway thread should exit cleanly");
        raw_server_thread
            .join()
            .expect("raw codex app-server thread should exit cleanly");

        if let Some(thread_dir) = PathBuf::from(&persisted_path).parent() {
            let _ = fs::remove_dir_all(thread_dir);
        }
    }

    fn read_json_text_message<S>(socket: &mut WebSocket<S>) -> Value
    where
        S: std::io::Read + std::io::Write,
    {
        let Message::Text(payload) = socket
            .read()
            .expect("websocket should receive one text message")
        else {
            panic!("expected websocket text message");
        };

        serde_json::from_str(payload.as_str()).expect("text payload should be valid json")
    }

    fn read_stream_text_message<S>(socket: &mut WebSocket<S>) -> Value
    where
        S: std::io::Read + std::io::Write,
    {
        loop {
            let message = read_json_text_message(socket);
            match message["type"].as_str() {
                Some("keepalive.state") | Some("runtime.ready") => continue,
                _ => return message,
            }
        }
    }

    fn read_binary_frame<S>(socket: &mut WebSocket<S>) -> crate::tunnel::protocol::StreamDataFrame
    where
        S: std::io::Read + std::io::Write,
    {
        let Message::Binary(payload) = socket
            .read()
            .expect("websocket should receive one binary frame")
        else {
            panic!("expected websocket binary frame");
        };

        decode_stream_data_frame(payload.as_ref()).expect("binary frame should decode")
    }
}
