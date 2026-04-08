//! Live bootstrap tunnel session orchestration for `sandboxd`.
//!
//! Once the daemon has initialized the sandbox runtime, it needs one loop that
//! owns the connected bootstrap websocket and routes multiplexed tunnel
//! traffic: keepalive publication, telemetry negotiation, agent-runtime
//! websocket streams, PTY streams, and file uploads.

use std::collections::{BTreeMap, BTreeSet};
use std::fmt::{self, Display};
use std::fs::{self, File, OpenOptions};
use std::io::{Read, Write};
use std::any::Any;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::thread::{self, JoinHandle};
use std::panic::{self, AssertUnwindSafe};

use futures_util::{SinkExt, StreamExt};
use tokio::runtime::Builder;
use tokio::sync::mpsc;
use tokio::task::JoinHandle as TokioJoinHandle;
use tokio_tungstenite::connect_async;
use tokio_tungstenite::tungstenite::{Error as WebSocketError, Message};
use tokio_tungstenite::{MaybeTlsStream, WebSocketStream};
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
use crate::tunnel::telemetry::{TelemetryRelay, TelemetryRelayFrame};

/// Default attachment root for file uploads received over the bootstrap tunnel.
pub const DEFAULT_ATTACHMENT_ROOT: &str = "/tmp/attachments";
/// Poll interval while the live tunnel session has no immediately available work.
pub const DEFAULT_TUNNEL_SESSION_POLL_INTERVAL: Duration = Duration::from_millis(10);
/// Poll interval while PTY output threads wait for the next blocking event.
pub const DEFAULT_PTY_EVENT_POLL_INTERVAL: Duration = Duration::from_millis(10);
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

enum TunnelWriterMessage {
    Text(String),
    Binary(Vec<u8>),
    Pong(Vec<u8>),
    Close,
}

enum TunnelSessionEvent {
    BootstrapMessage(Message),
    BootstrapClosed { reason: Option<String> },
    AgentMessage { stream_id: u32, message: Message },
    AgentClosed { stream_id: u32, reason: Option<String> },
    Wake,
}

struct AgentStreamState {
    sender: mpsc::UnboundedSender<Message>,
    send_window: StreamSendWindow,
}

impl TunnelSession {
    /// Starts one live bootstrap tunnel session thread for the initialized daemon.
    pub fn start(
        startup_input: &StartupInput,
        keepalive_manager: Arc<Mutex<KeepaliveManager>>,
        runtime_readiness_manager: Arc<Mutex<RuntimeReadinessManager>>,
        agent_endpoint_url: Option<String>,
        runtime_env: BTreeMap<String, String>,
        clock: Arc<dyn Clock>,
        sleeper: Arc<dyn Sleeper>,
    ) -> Result<Self, TunnelSessionError> {
        let sandbox_instance_id = derive_sandbox_instance_id(&startup_input.tunnel_gateway_ws_url)?;
        let attachment_root = PathBuf::from(DEFAULT_ATTACHMENT_ROOT);
        fs::create_dir_all(&attachment_root)
            .map_err(|error| TunnelSessionError::AttachmentRoot(error.to_string()))?;

        let shutdown_requested = Arc::new(AtomicBool::new(false));
        let (startup_result_sender, startup_result_receiver) = std::sync::mpsc::channel();
        let thread = thread::spawn({
            let shutdown_requested = shutdown_requested.clone();
            let cgroup_root = PathBuf::from(DEFAULT_CGROUP_ROOT);
            let runtime = TunnelSessionRuntime {
                keepalive_manager,
                runtime_readiness_manager,
                agent_endpoint_url,
                runtime_env,
                cgroup_root,
                attachment_root,
                sandbox_instance_id,
                shutdown_requested,
                clock,
                sleeper,
            };
            let connected_url = startup_input.tunnel_gateway_ws_url.clone();
            let bootstrap_token = startup_input.bootstrap_token.clone();
            move || {
                match panic::catch_unwind(AssertUnwindSafe(move || {
                    let runtime_builder = Builder::new_multi_thread()
                        .worker_threads(2)
                        .enable_all()
                        .build()
                        .map_err(|error| TunnelSessionError::ConfigureTunnelSocket(error.to_string()))?;

                    let startup_result_sender = startup_result_sender;
                    runtime_builder.block_on(async move {
                        let result =
                            run_tunnel_session(runtime, &connected_url, &bootstrap_token, startup_result_sender)
                                .await;
                        if let Err(error) = &result {
                            eprintln!("sandboxd bootstrap tunnel session exited: {error}");
                        }
                        result
                    })
                })) {
                    Ok(result) => result,
                    Err(payload) => {
                        eprintln!(
                            "sandboxd bootstrap tunnel session panicked: {}",
                            format_panic_payload(payload.as_ref())
                        );
                        Err(TunnelSessionError::SessionPanicked)
                    }
                }
            }
        });

        match startup_result_receiver.recv() {
            Ok(Ok(())) => {}
            Ok(Err(error)) => {
                let _ = thread.join();
                return Err(error);
            }
            Err(_) => {
                let _ = thread.join();
                return Err(TunnelSessionError::SessionPanicked);
            }
        }

        Ok(Self {
            shutdown_requested,
            thread: Some(thread),
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
    runtime_env: BTreeMap<String, String>,
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
    runtime_env: &'a BTreeMap<String, String>,
    sandbox_instance_id: &'a str,
    clock: &'a dyn Clock,
    sleeper: &'a dyn Sleeper,
}

struct TunnelSessionMutableState {
    telemetry_relay: TelemetryRelay,
    agent_streams: BTreeMap<u32, AgentStreamState>,
    pty_sessions: BTreeMap<String, PtySessionState>,
    file_uploads: BTreeMap<u32, FileUploadState>,
}

struct PtyOpenContext<'a> {
    cgroup_root: &'a Path,
    runtime_env: &'a BTreeMap<String, String>,
    sandbox_instance_id: &'a str,
    pty_sessions: &'a mut BTreeMap<String, PtySessionState>,
    clock: &'a dyn Clock,
    sleeper: &'a dyn Sleeper,
}

async fn run_tunnel_session(
    runtime: TunnelSessionRuntime,
    gateway_ws_url: &str,
    bootstrap_token: &str,
    startup_result_sender: std::sync::mpsc::Sender<Result<(), TunnelSessionError>>,
) -> Result<(), TunnelSessionError> {
    let connected_url = resolve_bootstrap_tunnel_url(gateway_ws_url, bootstrap_token)?;
    let (bootstrap_socket, _) = match connect_async(connected_url.as_str()).await {
        Ok(value) => value,
        Err(error) => {
            let startup_error = TunnelSessionError::ConfigureTunnelSocket(error.to_string());
            let _ = startup_result_sender.send(Err(TunnelSessionError::ConfigureTunnelSocket(
                error.to_string(),
            )));
            return Err(startup_error);
        }
    };
    let (tunnel_writer_sender, tunnel_writer_receiver) = mpsc::unbounded_channel();
    let (event_sender, mut event_receiver) = mpsc::unbounded_channel();
    let _bootstrap_socket_task = spawn_bootstrap_socket_task(
        bootstrap_socket,
        tunnel_writer_receiver,
        event_sender.clone(),
    );
    let _wake_thread = spawn_tunnel_wake_thread(
        runtime.shutdown_requested.clone(),
        runtime.sleeper.clone(),
        event_sender.clone(),
    );

    let mut session_state = TunnelSessionMutableState {
        telemetry_relay: TelemetryRelay::default(),
        agent_streams: BTreeMap::new(),
        pty_sessions: BTreeMap::new(),
        file_uploads: BTreeMap::new(),
    };
    send_telemetry_frames(
        &tunnel_writer_sender,
        session_state
            .telemetry_relay
            .attach_tunnel_connection()
            .map_err(|error| TunnelSessionError::AttachTelemetry(error.to_string()))?,
    )?;
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
    let _ = startup_result_sender.send(Ok(()));

    let loop_context = TunnelSessionLoopContext {
        agent_endpoint_url: runtime.agent_endpoint_url.as_deref(),
        attachment_root: &runtime.attachment_root,
        cgroup_root: &runtime.cgroup_root,
        runtime_env: &runtime.runtime_env,
        sandbox_instance_id: &runtime.sandbox_instance_id,
        clock: runtime.clock.as_ref(),
        sleeper: runtime.sleeper.as_ref(),
    };

    loop {
        {
            let publishable_state = runtime
                .keepalive_manager
                .lock()
                .expect("keepalive manager lock should not be poisoned")
                .take_publishable_state(loop_context.clock);
            if let Some(state) = publishable_state {
                let payload =
                    serde_json::to_string(&state).map_err(TunnelSessionError::PublishKeepalive)?;
                write_tunnel_text(&tunnel_writer_sender, payload)?;
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
                write_tunnel_text(&tunnel_writer_sender, payload)?;
            }
        }
        let Some(event) = event_receiver.recv().await else {
            break;
        };

        if runtime.shutdown_requested.load(Ordering::Relaxed) {
            for pty_session in session_state.pty_sessions.values() {
                let _ = pty_session.session.terminate(
                    loop_context.clock,
                    loop_context.sleeper,
                    DEFAULT_PTY_TERMINATE_POLL_INTERVAL,
                    DEFAULT_PTY_TERMINATE_TIMEOUT_MS,
                );
            }
            if let Ok(frames) = session_state.telemetry_relay.detach_tunnel_connection() {
                let _ = send_telemetry_frames(&tunnel_writer_sender, frames);
            }
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
            let _ = write_tunnel_close(&tunnel_writer_sender);
            return Ok(());
        }

        handle_tunnel_session_event(
            event,
            &tunnel_writer_sender,
            &event_sender,
            &loop_context,
            &mut session_state,
        )
        .await?;
    }

    Ok(())
}

type TunnelWebSocket = WebSocketStream<MaybeTlsStream<tokio::net::TcpStream>>;
fn spawn_bootstrap_socket_task(
    mut socket: TunnelWebSocket,
    mut receiver: mpsc::UnboundedReceiver<TunnelWriterMessage>,
    event_sender: mpsc::UnboundedSender<TunnelSessionEvent>,
) -> TokioJoinHandle<Result<(), TunnelSessionError>> {
    tokio::spawn(async move {
        let notify_bootstrap_closed = |reason: Option<String>| {
            let _ = event_sender.send(TunnelSessionEvent::BootstrapClosed { reason });
        };

        loop {
            tokio::select! {
                outbound = receiver.recv() => {
                    let Some(message) = outbound else {
                        notify_bootstrap_closed(Some("bootstrap tunnel writer channel closed".to_string()));
                        return Ok(());
                    };

                    match message {
                        TunnelWriterMessage::Text(payload) => {
                            if let Err(error) = socket.send(Message::Text(payload.into())).await {
                                notify_bootstrap_closed(Some(format!(
                                    "failed to write bootstrap tunnel text frame: {error}"
                                )));
                                return Err(TunnelSessionError::WriteTunnelText(error.to_string()));
                            }
                        }
                        TunnelWriterMessage::Binary(payload) => {
                            if let Err(error) = socket.send(Message::Binary(payload.into())).await {
                                notify_bootstrap_closed(Some(format!(
                                    "failed to write bootstrap tunnel binary frame: {error}"
                                )));
                                return Err(TunnelSessionError::WriteTunnelBinary(error.to_string()));
                            }
                        }
                        TunnelWriterMessage::Pong(payload) => {
                            if let Err(error) = socket.send(Message::Pong(payload.into())).await {
                                notify_bootstrap_closed(Some(format!(
                                    "failed to write bootstrap tunnel pong frame: {error}"
                                )));
                                return Err(TunnelSessionError::WriteTunnelText(error.to_string()));
                            }
                        }
                        TunnelWriterMessage::Close => {
                            if let Err(error) = socket.send(Message::Close(None)).await {
                                notify_bootstrap_closed(Some(format!(
                                    "failed to write bootstrap tunnel close frame: {error}"
                                )));
                                return Err(TunnelSessionError::WriteTunnelText(error.to_string()));
                            }
                            notify_bootstrap_closed(None);
                            return Ok(());
                        }
                    }
                }
                inbound = socket.next() => {
                    match inbound {
                        Some(Ok(Message::Close(_))) | Some(Err(WebSocketError::ConnectionClosed)) | None => {
                            let _ = event_sender.send(TunnelSessionEvent::BootstrapClosed { reason: None });
                            return Ok(());
                        }
                        Some(Ok(Message::Ping(payload))) => {
                            socket
                                .send(Message::Pong(payload))
                                .await
                                .map_err(|error| TunnelSessionError::WriteTunnelText(error.to_string()))?;
                        }
                        Some(Ok(message)) => {
                            let _ = event_sender.send(TunnelSessionEvent::BootstrapMessage(message));
                        }
                        Some(Err(error)) => {
                            let _ = event_sender.send(TunnelSessionEvent::BootstrapClosed {
                                reason: Some(error.to_string()),
                            });
                            return Ok(());
                        }
                    }
                }
            }
        }
    })
}

fn spawn_tunnel_wake_thread(
    shutdown_requested: Arc<AtomicBool>,
    sleeper: Arc<dyn Sleeper>,
    event_sender: mpsc::UnboundedSender<TunnelSessionEvent>,
) -> JoinHandle<()> {
    thread::spawn(move || loop {
        if shutdown_requested.load(Ordering::Relaxed) {
            let _ = event_sender.send(TunnelSessionEvent::Wake);
            return;
        }

        sleeper.sleep(DEFAULT_TUNNEL_SESSION_POLL_INTERVAL);
        if event_sender.send(TunnelSessionEvent::Wake).is_err() {
            return;
        }
    })
}

fn spawn_agent_stream_task(
    stream_id: u32,
    runtime_socket: TunnelWebSocket,
    event_sender: mpsc::UnboundedSender<TunnelSessionEvent>,
) -> mpsc::UnboundedSender<Message> {
    let (mut writer, mut reader) = runtime_socket.split();
    let (sender, mut receiver) = mpsc::unbounded_channel();
    tokio::spawn(async move {
        loop {
            tokio::select! {
                message = receiver.recv() => {
                    let Some(message) = message else {
                        let _ = writer.send(Message::Close(None)).await;
                        let _ = event_sender.send(TunnelSessionEvent::AgentClosed {
                            stream_id,
                            reason: None,
                        });
                        return;
                    };
                    if let Err(error) = writer.send(message).await {
                        let _ = event_sender.send(TunnelSessionEvent::AgentClosed {
                            stream_id,
                            reason: Some(error.to_string()),
                        });
                        return;
                    }
                }
                message = reader.next() => {
                    match message {
                        Some(Ok(Message::Close(_))) | Some(Err(WebSocketError::ConnectionClosed)) | None => {
                            let _ = event_sender.send(TunnelSessionEvent::AgentClosed {
                                stream_id,
                                reason: None,
                            });
                            return;
                        }
                        Some(Ok(message)) => {
                            let _ = event_sender.send(TunnelSessionEvent::AgentMessage { stream_id, message });
                        }
                        Some(Err(error)) => {
                            let _ = event_sender.send(TunnelSessionEvent::AgentClosed {
                                stream_id,
                                reason: Some(error.to_string()),
                            });
                            return;
                        }
                    }
                }
            }
        }
    });
    sender
}

fn poll_pty_sessions(
    tunnel_writer_sender: &mpsc::UnboundedSender<TunnelWriterMessage>,
    pty_sessions: &mut BTreeMap<String, PtySessionState>,
    clock: &dyn Clock,
    sleeper: &dyn Sleeper,
) -> Result<bool, TunnelSessionError> {
    let session_ids: Vec<String> = pty_sessions.keys().cloned().collect();
    let mut did_work = false;
    let mut closed_session_ids = Vec::new();

    for session_id in session_ids {
        let Some(pty_state) = pty_sessions.get_mut(&session_id) else {
            continue;
        };

        let next_event = match pty_state.session.next_event_timeout(Duration::from_millis(0)) {
            Ok(event) => event,
            Err(_) => {
                closed_session_ids.push(session_id.clone());
                continue;
            }
        };
        let Some(event) = next_event else {
            continue;
        };
        did_work = true;
        match event {
            PtyEvent::Output(chunk) => {
                let attached_stream_ids: Vec<u32> =
                    pty_state.attached_stream_ids.iter().copied().collect();
                for stream_id in attached_stream_ids {
                    let Some(send_window) = pty_state.send_windows_by_stream_id.get_mut(&stream_id)
                    else {
                        continue;
                    };
                    if !send_window.try_consume(chunk.len()) {
                        let _ = write_tunnel_text(
                            tunnel_writer_sender,
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

                    let encoded =
                        match encode_stream_data_frame(stream_id, PAYLOAD_KIND_RAW_BYTES, &chunk) {
                            Ok(encoded) => encoded,
                            Err(_) => continue,
                        };
                    let _ = write_tunnel_binary(tunnel_writer_sender, encoded);
                }
            }
            PtyEvent::Exit(exit_code) => {
                for stream_id in pty_state.attached_stream_ids.iter().copied() {
                    let _ = write_tunnel_text(
                        tunnel_writer_sender,
                        pty_exit_event(stream_id, exit_code),
                    );
                }
                closed_session_ids.push(session_id.clone());
            }
            PtyEvent::Closed => {
                if let Some(exit_code) = pty_state.session.exit_code() {
                    for stream_id in pty_state.attached_stream_ids.iter().copied() {
                        let _ = write_tunnel_text(
                            tunnel_writer_sender,
                            pty_exit_event(stream_id, exit_code),
                        );
                    }
                    closed_session_ids.push(session_id.clone());
                }
            }
            PtyEvent::Error(message) => {
                let _ = write_tunnel_text(
                    tunnel_writer_sender,
                    stream_reset(
                        pty_state.primary_stream_id,
                        STREAM_RESET_CODE_TARGET_CLOSED,
                        message,
                    ),
                );
                closed_session_ids.push(session_id.clone());
            }
        }
    }

    for session_id in closed_session_ids {
        pty_sessions.remove(&session_id);
    }

    Ok(did_work)
}

async fn handle_tunnel_session_event(
    event: TunnelSessionEvent,
    tunnel_writer_sender: &mpsc::UnboundedSender<TunnelWriterMessage>,
    event_sender: &mpsc::UnboundedSender<TunnelSessionEvent>,
    context: &TunnelSessionLoopContext<'_>,
    session_state: &mut TunnelSessionMutableState,
) -> Result<(), TunnelSessionError> {
    match event {
        TunnelSessionEvent::BootstrapClosed { reason } => {
            let reason_text = reason.unwrap_or_else(|| "bootstrap tunnel closed".to_string());
            eprintln!("sandboxd bootstrap tunnel closed: {reason_text}");
            Err(TunnelSessionError::ReadTunnel(reason_text))
        }
        TunnelSessionEvent::Wake => {
            let _ = poll_pty_sessions(
                tunnel_writer_sender,
                &mut session_state.pty_sessions,
                context.clock,
                context.sleeper,
            )?;
            Ok(())
        }
        TunnelSessionEvent::BootstrapMessage(message) => match message {
            Message::Text(payload) => {
                if let Some(frames) = session_state
                    .telemetry_relay
                    .handle_control_message(&payload)
                    .map_err(|error| TunnelSessionError::HandleTelemetry(error.to_string()))?
                {
                    send_telemetry_frames(tunnel_writer_sender, frames)?;
                    return Ok(());
                }

                let control_message = parse_stream_control_message(&payload)
                    .map_err(|error| TunnelSessionError::ParseControl(error.to_string()))?;
                handle_tunnel_control_message(
                    tunnel_writer_sender,
                    event_sender,
                    control_message,
                    context,
                    &mut session_state.agent_streams,
                    &mut session_state.pty_sessions,
                    &mut session_state.file_uploads,
                )
                .await
            }
            Message::Binary(payload) => {
                let frame = decode_stream_data_frame(payload.as_ref())
                    .map_err(|error| TunnelSessionError::ParseDataFrame(error.to_string()))?;
                handle_tunnel_binary_frame(
                    tunnel_writer_sender,
                    frame,
                    &mut session_state.agent_streams,
                    &mut session_state.pty_sessions,
                    &mut session_state.file_uploads,
                )
            }
            Message::Ping(payload) => write_tunnel_pong(tunnel_writer_sender, payload.to_vec()),
            Message::Pong(_) => Ok(()),
            Message::Close(_) => Err(TunnelSessionError::ReadTunnel(
                "bootstrap tunnel closed".to_string(),
            )),
            _ => Ok(()),
        },
        TunnelSessionEvent::AgentMessage { stream_id, message } => match message {
            Message::Text(payload) => {
                let Some(agent_stream) = session_state.agent_streams.get_mut(&stream_id) else {
                    return Ok(());
                };
                if !agent_stream.send_window.try_consume(payload.len()) {
                    session_state.agent_streams.remove(&stream_id);
                    return write_tunnel_text(
                        tunnel_writer_sender,
                        stream_reset(
                            stream_id,
                            STREAM_RESET_CODE_STREAM_WINDOW_EXHAUSTED,
                            "agent stream send window is exhausted",
                        ),
                    );
                }
                let encoded =
                    encode_stream_data_frame(stream_id, PAYLOAD_KIND_WEBSOCKET_TEXT, payload.as_bytes())
                        .map_err(|error| TunnelSessionError::AgentRead(error.to_string()))?;
                write_tunnel_binary(tunnel_writer_sender, encoded)
            }
            Message::Binary(payload) => {
                let Some(agent_stream) = session_state.agent_streams.get_mut(&stream_id) else {
                    return Ok(());
                };
                if !agent_stream.send_window.try_consume(payload.len()) {
                    session_state.agent_streams.remove(&stream_id);
                    return write_tunnel_text(
                        tunnel_writer_sender,
                        stream_reset(
                            stream_id,
                            STREAM_RESET_CODE_STREAM_WINDOW_EXHAUSTED,
                            "agent stream send window is exhausted",
                        ),
                    );
                }
                let encoded =
                    encode_stream_data_frame(stream_id, PAYLOAD_KIND_WEBSOCKET_BINARY, payload.as_ref())
                        .map_err(|error| TunnelSessionError::AgentRead(error.to_string()))?;
                write_tunnel_binary(tunnel_writer_sender, encoded)
            }
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
                session_state.agent_streams.remove(&stream_id);
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
        },
        TunnelSessionEvent::AgentClosed { stream_id, reason } => {
            if session_state.agent_streams.remove(&stream_id).is_some() {
                write_tunnel_text(
                    tunnel_writer_sender,
                    stream_reset(
                        stream_id,
                        STREAM_RESET_CODE_TARGET_CLOSED,
                        reason.unwrap_or_else(|| "agent runtime websocket closed".to_string()),
                    ),
                )?;
            }
            Ok(())
        }
    }
}

fn format_panic_payload(payload: &(dyn Any + Send)) -> String {
    if let Some(message) = payload.downcast_ref::<&str>() {
        return (*message).to_string();
    }
    if let Some(message) = payload.downcast_ref::<String>() {
        return message.clone();
    }
    "unknown panic payload".to_string()
}

async fn handle_tunnel_control_message(
    tunnel_writer_sender: &mpsc::UnboundedSender<TunnelWriterMessage>,
    event_sender: &mpsc::UnboundedSender<TunnelSessionEvent>,
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
                    tunnel_writer_sender,
                    stream_open_error(
                        message.stream_id,
                        CONNECT_ERROR_CODE_AGENT_ENDPOINT_DIAL_FAILED,
                        "agent runtime endpoint is not available",
                    ),
                )?;
                return Ok(());
            };

            let (runtime_socket, _) = connect_async(runtime_endpoint_url)
                .await
                .map_err(|error| TunnelSessionError::AgentDial(error.to_string()))?;
            let sender = spawn_agent_stream_task(message.stream_id, runtime_socket, event_sender.clone());
            agent_streams.insert(
                message.stream_id,
                AgentStreamState {
                    sender,
                    send_window: StreamSendWindow::default(),
                },
            );
            write_tunnel_text(tunnel_writer_sender, stream_open_ok(message.stream_id))?;
        }
        StreamControlMessage::OpenPty(message) => {
            let mut pty_open_context = PtyOpenContext {
                cgroup_root: context.cgroup_root,
                runtime_env: context.runtime_env,
                sandbox_instance_id: context.sandbox_instance_id,
                pty_sessions,
                clock: context.clock,
                sleeper: context.sleeper,
            };
            handle_pty_open(
                tunnel_writer_sender,
                message,
                &mut pty_open_context,
            )?;
        }
        StreamControlMessage::OpenFileUpload(message) => {
            let upload_state =
                create_file_upload_state(&message, context.attachment_root, context.clock)
                    .map_err(TunnelSessionError::FileUpload)?;
            file_uploads.insert(message.stream_id, upload_state);
            write_tunnel_text(tunnel_writer_sender, stream_open_ok(message.stream_id))?;
        }
        StreamControlMessage::Signal(message) => {
            let Some(pty_state) = pty_sessions
                .values_mut()
                .find(|pty_state| pty_state.attached_stream_ids.contains(&message.stream_id))
            else {
                write_tunnel_text(
                    tunnel_writer_sender,
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
                let _ = agent_stream.sender.send(Message::Close(None));
                return Ok(());
            }
            if let Some(pty_session_id) = pty_sessions
                .iter()
                .find(|(_, pty_state)| pty_state.attached_stream_ids.contains(&message.stream_id))
                .map(|(session_id, _)| session_id.clone())
            {
                handle_pty_close(
                    tunnel_writer_sender,
                    &pty_session_id,
                    message.stream_id,
                    pty_sessions,
                    context.clock,
                    context.sleeper,
                )?;
                return Ok(());
            }
            if let Some(upload_state) = file_uploads.remove(&message.stream_id) {
                finalize_file_upload(tunnel_writer_sender, message.stream_id, upload_state)?;
                return Ok(());
            }

            write_tunnel_text(
                tunnel_writer_sender,
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
                let Some(send_window) = pty_state.send_windows_by_stream_id.get_mut(&message.stream_id) else {
                    return Ok(());
                };
                send_window
                    .add(message.bytes)
                    .map_err(|error| TunnelSessionError::ParseControl(error.to_string()))?;
                return Ok(());
            }

            write_tunnel_text(
                tunnel_writer_sender,
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
    tunnel_writer_sender: &mpsc::UnboundedSender<TunnelWriterMessage>,
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
                    .sender
                    .send(Message::Text(payload.into()))
                    .map_err(|error| TunnelSessionError::AgentWrite(error.to_string()))?;
            }
            PAYLOAD_KIND_WEBSOCKET_BINARY => {
                agent_stream
                    .sender
                    .send(Message::Binary(frame.payload.into()))
                    .map_err(|error| TunnelSessionError::AgentWrite(error.to_string()))?;
            }
            _ => {
                write_tunnel_text(
                    tunnel_writer_sender,
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
                tunnel_writer_sender,
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
            tunnel_writer_sender,
            stream_window(frame.stream_id, frame.payload.len()),
        )?;
        return Ok(());
    }

    if let Some(upload_state) = file_uploads.get_mut(&frame.stream_id) {
        if frame.payload_kind != PAYLOAD_KIND_RAW_BYTES {
            write_tunnel_text(
                tunnel_writer_sender,
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
                tunnel_writer_sender,
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
            tunnel_writer_sender,
            stream_window(frame.stream_id, frame.payload.len()),
        )?;
        return Ok(());
    }

    write_tunnel_text(
        tunnel_writer_sender,
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
    tunnel_writer_sender: &mpsc::UnboundedSender<TunnelWriterMessage>,
    message: crate::tunnel::protocol::PtyStreamOpen,
    context: &mut PtyOpenContext<'_>,
) -> Result<(), TunnelSessionError> {
    match message.channel.session {
        crate::tunnel::protocol::PtySessionMode::Attach => {
            let Some(pty_state) = context
                .pty_sessions
                .get_mut(&message.channel.pty_session_id)
            else {
                write_tunnel_text(
                    tunnel_writer_sender,
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
            write_tunnel_text(tunnel_writer_sender, stream_open_ok(message.stream_id))?;
        }
        crate::tunnel::protocol::PtySessionMode::Create => {
            if context
                .pty_sessions
                .contains_key(&message.channel.pty_session_id)
            {
                write_tunnel_text(
                    tunnel_writer_sender,
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
                    env: context.runtime_env.clone(),
                },
                context.cgroup_root,
                context.sandbox_instance_id,
                context.clock,
                context.sleeper,
            ) {
                Ok(session) => session,
                Err(error) => {
                    write_tunnel_text(
                        tunnel_writer_sender,
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
            context.pty_sessions.insert(
                message.channel.pty_session_id.clone(),
                PtySessionState {
                    session,
                    primary_stream_id: message.stream_id,
                    attached_stream_ids,
                    send_windows_by_stream_id,
                },
            );
            write_tunnel_text(tunnel_writer_sender, stream_open_ok(message.stream_id))?;
        }
    }

    Ok(())
}

fn handle_pty_close(
    tunnel_writer_sender: &mpsc::UnboundedSender<TunnelWriterMessage>,
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
            tunnel_writer_sender,
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
                write_tunnel_text(
                    tunnel_writer_sender,
                    pty_exit_event(attached_stream_id, exit_code),
                )?;
            }
            pty_sessions.remove(pty_session_id);
        }
        Err(error) => {
            write_tunnel_text(
                tunnel_writer_sender,
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
    tunnel_writer_sender: &mpsc::UnboundedSender<TunnelWriterMessage>,
    stream_id: u32,
    upload_state: FileUploadState,
) -> Result<(), TunnelSessionError> {
    if upload_state.received_bytes != upload_state.size_bytes {
        write_tunnel_text(
            tunnel_writer_sender,
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
            write_tunnel_text(tunnel_writer_sender, stream_reset(stream_id, code, message))?;
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
        tunnel_writer_sender,
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
    write_tunnel_text(tunnel_writer_sender, stream_complete(stream_id))?;

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

fn resolve_bootstrap_tunnel_url(
    gateway_ws_url: &str,
    bootstrap_token: &str,
) -> Result<String, TunnelSessionError> {
    let normalized_token = bootstrap_token.trim();
    if normalized_token.is_empty() {
        return Err(TunnelSessionError::InvalidGatewayUrl(
            "sandbox tunnel bootstrap token is required".to_string(),
        ));
    }

    let mut parsed_url = Url::parse(gateway_ws_url)
        .map_err(|error| TunnelSessionError::InvalidGatewayUrl(error.to_string()))?;
    match parsed_url.scheme() {
        "ws" | "wss" => {}
        _ => {
            return Err(TunnelSessionError::InvalidGatewayUrl(
                "sandbox tunnel gateway ws url must use ws or wss scheme".to_string(),
            ));
        }
    }

    parsed_url
        .query_pairs_mut()
        .append_pair("bootstrap_token", normalized_token);
    Ok(parsed_url.to_string())
}

fn send_telemetry_frames(
    tunnel_writer_sender: &mpsc::UnboundedSender<TunnelWriterMessage>,
    frames: Vec<TelemetryRelayFrame>,
) -> Result<(), TunnelSessionError> {
    for frame in frames {
        match frame {
            TelemetryRelayFrame::Text(payload) => write_tunnel_text(tunnel_writer_sender, payload)?,
            TelemetryRelayFrame::Binary(payload) => {
                write_tunnel_binary(tunnel_writer_sender, payload)?
            }
        }
    }

    Ok(())
}

fn write_tunnel_text(
    tunnel_writer_sender: &mpsc::UnboundedSender<TunnelWriterMessage>,
    payload: String,
) -> Result<(), TunnelSessionError> {
    tunnel_writer_sender
        .send(TunnelWriterMessage::Text(payload))
        .map_err(|_| {
            TunnelSessionError::WriteTunnelText(
                "bootstrap tunnel writer is closed".to_string(),
            )
        })
}

fn write_tunnel_binary(
    tunnel_writer_sender: &mpsc::UnboundedSender<TunnelWriterMessage>,
    payload: Vec<u8>,
) -> Result<(), TunnelSessionError> {
    tunnel_writer_sender
        .send(TunnelWriterMessage::Binary(payload))
        .map_err(|_| {
            TunnelSessionError::WriteTunnelBinary(
                "bootstrap tunnel writer is closed".to_string(),
            )
        })
}

fn write_tunnel_pong(
    tunnel_writer_sender: &mpsc::UnboundedSender<TunnelWriterMessage>,
    payload: Vec<u8>,
) -> Result<(), TunnelSessionError> {
    tunnel_writer_sender
        .send(TunnelWriterMessage::Pong(payload))
        .map_err(|_| {
            TunnelSessionError::WriteTunnelText(
                "bootstrap tunnel writer is closed".to_string(),
            )
        })
}

fn write_tunnel_close(
    tunnel_writer_sender: &mpsc::UnboundedSender<TunnelWriterMessage>,
) -> Result<(), TunnelSessionError> {
    let _ = tunnel_writer_sender.send(TunnelWriterMessage::Close);
    Ok(())
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
                    other => {
                        panic!("unexpected bootstrap control message before streams: {other:?}")
                    }
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
                        "type": "stream.window",
                        "streamId": 7,
                        "bytes": agent_response.payload.len()
                    })
                    .to_string()
                    .into(),
                ))
                .expect("gateway should restore agent stream window credit");

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
        let tunnel_session = TunnelSession::start(
            &startup_input,
            keepalive_manager,
            runtime_readiness_manager,
            Some(runtime_adapters.adapters()[0].listen_url().to_string()),
            BTreeMap::new(),
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
