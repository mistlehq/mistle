use std::collections::BTreeSet;
use std::error::Error;
use std::fmt::{self, Display};
use std::fs;
use std::path::{Path, PathBuf};
use std::process::{Command as StdCommand, Stdio};
use std::time::{Duration, SystemTime};

use futures_util::{SinkExt, StreamExt};
use serde::Deserialize;
use tokio::net::{TcpListener, TcpStream};
use tokio::process::Command as TokioCommand;
use tokio::time::timeout;
use tokio_tungstenite::tungstenite::Message;
use tokio_tungstenite::{MaybeTlsStream, WebSocketStream, accept_async, connect_async};

const STREAM_ID: u32 = 1;
const DATA_FRAME_KIND: u8 = 0x01;
const PAYLOAD_KIND_WEBSOCKET_TEXT: u8 = 0x02;
const PAYLOAD_KIND_WEBSOCKET_BINARY: u8 = 0x03;
const AGENT_STREAM_WINDOW_BYTES: usize = 16 * 1024 * 1024;
const STREAM_OPEN_TIMEOUT: Duration = Duration::from_secs(30);
const CODEX_MISTLE_MODEL_PROVIDER_ID: &str = "mistle-remote";
const CODEX_MISTLE_MODEL_PROVIDER_CONFIG: &str = "model_providers.mistle-remote={ name = \"Mistle Remote\", base_url = \"http://127.0.0.1:1/v1\", wire_api = \"responses\", requires_openai_auth = false, supports_websockets = true }";

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CodexRunConfig {
    pub tunnel_url: String,
    pub codex_args: Vec<String>,
}

#[derive(Debug)]
pub enum CodexRunError {
    InvalidCodexArgs(&'static str),
    BindLocalProxy(std::io::Error),
    LocalProxyAddress(std::io::Error),
    SpawnCodex(std::io::Error),
    CodexExitedBeforeConnect(String),
    AcceptCodex(tokio_tungstenite::tungstenite::Error),
    ConnectTunnel(tokio_tungstenite::tungstenite::Error),
    OpenAgentStreamTimeout,
    OpenAgentStreamRejected { code: String, message: String },
    CreateCodexHome(std::io::Error),
    WriteCodexConfig(std::io::Error),
    WriteTunnel(tokio_tungstenite::tungstenite::Error),
    ReadTunnel(tokio_tungstenite::tungstenite::Error),
    WriteCodex(tokio_tungstenite::tungstenite::Error),
    ReadCodex(tokio_tungstenite::tungstenite::Error),
    DecodeTunnelControl(serde_json::Error),
    DecodeDataFrame(&'static str),
    DecodeAgentText(std::string::FromUtf8Error),
    SendWindowExhausted,
    CodexExit(std::io::Error),
    CodexFailed(Option<i32>),
}

impl Display for CodexRunError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::InvalidCodexArgs(message) => write!(formatter, "{message}"),
            Self::BindLocalProxy(error) => write!(formatter, "failed to bind local proxy: {error}"),
            Self::LocalProxyAddress(error) => {
                write!(formatter, "failed to read local proxy address: {error}")
            }
            Self::SpawnCodex(error) => write!(formatter, "failed to spawn codex: {error}"),
            Self::CodexExitedBeforeConnect(status) => {
                write!(
                    formatter,
                    "codex exited before connecting to the local proxy: {status}"
                )
            }
            Self::AcceptCodex(error) => {
                write!(
                    formatter,
                    "failed to accept codex websocket connection: {error}"
                )
            }
            Self::ConnectTunnel(error) => {
                write!(
                    formatter,
                    "failed to connect Mistle tunnel websocket: {error}"
                )
            }
            Self::OpenAgentStreamTimeout => {
                write!(
                    formatter,
                    "timed out waiting for sandbox agent stream to open"
                )
            }
            Self::OpenAgentStreamRejected { code, message } => {
                write!(
                    formatter,
                    "sandbox agent stream rejected ({code}): {message}"
                )
            }
            Self::CreateCodexHome(error) => {
                write!(formatter, "failed to create temporary Codex home: {error}")
            }
            Self::WriteCodexConfig(error) => {
                write!(
                    formatter,
                    "failed to write temporary Codex config.toml: {error}"
                )
            }
            Self::WriteTunnel(error) => write!(formatter, "failed to write Mistle tunnel: {error}"),
            Self::ReadTunnel(error) => write!(formatter, "failed to read Mistle tunnel: {error}"),
            Self::WriteCodex(error) => {
                write!(formatter, "failed to write codex websocket: {error}")
            }
            Self::ReadCodex(error) => write!(formatter, "failed to read codex websocket: {error}"),
            Self::DecodeTunnelControl(error) => {
                write!(
                    formatter,
                    "failed to decode Mistle tunnel control message: {error}"
                )
            }
            Self::DecodeDataFrame(message) => write!(formatter, "{message}"),
            Self::DecodeAgentText(error) => {
                write!(
                    formatter,
                    "failed to decode agent text payload as UTF-8: {error}"
                )
            }
            Self::SendWindowExhausted => write!(
                formatter,
                "sandbox agent stream send window is exhausted; refusing to send another frame"
            ),
            Self::CodexExit(error) => write!(formatter, "failed to wait for codex: {error}"),
            Self::CodexFailed(code) => match code {
                Some(code) => write!(formatter, "codex exited with status code {code}"),
                None => write!(formatter, "codex exited unsuccessfully"),
            },
        }
    }
}

impl Error for CodexRunError {
    fn source(&self) -> Option<&(dyn Error + 'static)> {
        match self {
            Self::BindLocalProxy(error)
            | Self::LocalProxyAddress(error)
            | Self::SpawnCodex(error)
            | Self::CreateCodexHome(error)
            | Self::WriteCodexConfig(error)
            | Self::CodexExit(error) => Some(error),
            Self::AcceptCodex(error)
            | Self::ConnectTunnel(error)
            | Self::WriteTunnel(error)
            | Self::ReadTunnel(error)
            | Self::WriteCodex(error)
            | Self::ReadCodex(error) => Some(error),
            Self::DecodeTunnelControl(error) => Some(error),
            Self::DecodeAgentText(error) => Some(error),
            Self::InvalidCodexArgs(_)
            | Self::CodexExitedBeforeConnect(_)
            | Self::OpenAgentStreamTimeout
            | Self::OpenAgentStreamRejected { .. }
            | Self::DecodeDataFrame(_)
            | Self::SendWindowExhausted
            | Self::CodexFailed(_) => None,
        }
    }
}

pub async fn run_codex(config: CodexRunConfig) -> Result<(), CodexRunError> {
    validate_codex_args(&config.codex_args)?;

    let listener = TcpListener::bind("127.0.0.1:0")
        .await
        .map_err(CodexRunError::BindLocalProxy)?;
    let local_addr = listener
        .local_addr()
        .map_err(CodexRunError::LocalProxyAddress)?;
    let remote_url = format!("ws://{local_addr}");
    let codex_command_args = codex_command_args(&remote_url, &config.codex_args)?;
    let codex_home = create_codex_home()?;

    eprintln!("mistle: starting local Codex proxy on {remote_url}");
    let mut child = TokioCommand::new("codex")
        .args(codex_command_args)
        .env("CODEX_HOME", codex_home.path())
        .stdin(Stdio::inherit())
        .stdout(Stdio::inherit())
        .stderr(Stdio::inherit())
        .spawn()
        .map_err(CodexRunError::SpawnCodex)?;

    let codex_socket = tokio::select! {
        accept_result = accept_codex(&listener) => accept_result?,
        status = child.wait() => {
            let status = status.map_err(CodexRunError::CodexExit)?;
            return Err(CodexRunError::CodexExitedBeforeConnect(status.to_string()));
        }
    };

    eprintln!("mistle: connecting to Mistle sandbox tunnel");
    let (mut tunnel_socket, _) = connect_async(config.tunnel_url)
        .await
        .map_err(CodexRunError::ConnectTunnel)?;
    open_agent_stream(&mut tunnel_socket).await?;

    eprintln!("mistle: connected Codex to sandbox agent stream");
    let bridge_result = bridge_codex_to_tunnel(codex_socket, tunnel_socket).await;
    let child_status = child.wait().await.map_err(CodexRunError::CodexExit)?;

    bridge_result?;
    if !child_status.success() {
        return Err(CodexRunError::CodexFailed(child_status.code()));
    }

    Ok(())
}

pub fn validate_codex_args(codex_args: &[String]) -> Result<(), CodexRunError> {
    if codex_args
        .iter()
        .any(|arg| arg == "--remote" || arg.starts_with("--remote="))
    {
        return Err(CodexRunError::InvalidCodexArgs(
            "codex arguments must not include --remote; mistle manages the remote endpoint",
        ));
    }

    Ok(())
}

fn codex_command_args(
    remote_url: &str,
    codex_args: &[String],
) -> Result<Vec<String>, CodexRunError> {
    validate_codex_args(codex_args)?;

    let mut command_args = Vec::with_capacity(codex_args.len() + 6);
    match codex_args.first().map(String::as_str) {
        Some("resume" | "fork") => {
            command_args.push(codex_args[0].clone());
            push_mistle_codex_config_args(&mut command_args);
            command_args.push("--remote".to_owned());
            command_args.push(remote_url.to_owned());
            command_args.extend(codex_args.iter().skip(1).cloned());
        }
        _ => {
            push_mistle_codex_config_args(&mut command_args);
            command_args.push("--remote".to_owned());
            command_args.push(remote_url.to_owned());
            command_args.extend(codex_args.iter().cloned());
        }
    }

    Ok(command_args)
}

fn push_mistle_codex_config_args(command_args: &mut Vec<String>) {
    command_args.push("-c".to_owned());
    command_args.push(format!(
        "model_provider=\"{CODEX_MISTLE_MODEL_PROVIDER_ID}\""
    ));
    command_args.push("-c".to_owned());
    command_args.push(CODEX_MISTLE_MODEL_PROVIDER_CONFIG.to_owned());
}

fn create_codex_home() -> Result<CodexTempHome, CodexRunError> {
    let path = unique_codex_home_path()?;
    fs::create_dir(&path).map_err(CodexRunError::CreateCodexHome)?;
    fs::write(path.join("config.toml"), render_local_codex_config()?)
        .map_err(CodexRunError::WriteCodexConfig)?;
    Ok(CodexTempHome { path })
}

fn render_local_codex_config() -> Result<String, CodexRunError> {
    let mut trusted_projects = BTreeSet::new();
    let current_dir = std::env::current_dir().map_err(CodexRunError::CreateCodexHome)?;
    trusted_projects.insert(current_dir.clone());
    if let Ok(canonical_current_dir) = fs::canonicalize(&current_dir) {
        trusted_projects.insert(canonical_current_dir);
    }
    if let Some(git_common_root) = git_common_project_root(&current_dir) {
        trusted_projects.insert(git_common_root);
    }

    let mut config =
        String::from("approval_policy = \"never\"\nsandbox_mode = \"danger-full-access\"\n");
    for project in trusted_projects {
        config.push_str("\n[projects.");
        config.push_str(toml_string(project.to_string_lossy().as_ref()).as_str());
        config.push_str("]\ntrust_level = \"trusted\"\n");
    }

    Ok(config)
}

fn git_common_project_root(current_dir: &Path) -> Option<PathBuf> {
    let output = StdCommand::new("git")
        .args([
            "-C",
            current_dir.to_string_lossy().as_ref(),
            "rev-parse",
            "--path-format=absolute",
            "--git-common-dir",
        ])
        .output()
        .ok()?;

    if !output.status.success() {
        return None;
    }

    let git_common_dir = String::from_utf8(output.stdout).ok()?;
    let git_common_dir = PathBuf::from(git_common_dir.trim());
    if git_common_dir.file_name().and_then(|name| name.to_str()) != Some(".git") {
        return None;
    }

    git_common_dir.parent().map(Path::to_path_buf)
}

fn toml_string(value: &str) -> String {
    let mut escaped = String::from("\"");
    for character in value.chars() {
        match character {
            '\\' => escaped.push_str("\\\\"),
            '"' => escaped.push_str("\\\""),
            '\n' => escaped.push_str("\\n"),
            '\r' => escaped.push_str("\\r"),
            '\t' => escaped.push_str("\\t"),
            character => escaped.push(character),
        }
    }
    escaped.push('"');
    escaped
}

fn unique_codex_home_path() -> Result<PathBuf, CodexRunError> {
    let timestamp = SystemTime::now()
        .duration_since(SystemTime::UNIX_EPOCH)
        .map_err(std::io::Error::other)
        .map_err(CodexRunError::CreateCodexHome)?
        .as_nanos();
    Ok(std::env::temp_dir().join(format!(
        "mistle-codex-home-{}-{timestamp}",
        std::process::id()
    )))
}

#[derive(Debug)]
struct CodexTempHome {
    path: PathBuf,
}

impl CodexTempHome {
    fn path(&self) -> &Path {
        self.path.as_path()
    }
}

impl Drop for CodexTempHome {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.path);
    }
}

async fn accept_codex(listener: &TcpListener) -> Result<WebSocketStream<TcpStream>, CodexRunError> {
    let (stream, peer_addr) = listener
        .accept()
        .await
        .map_err(CodexRunError::BindLocalProxy)?;
    eprintln!("mistle: accepted Codex websocket connection from {peer_addr}");
    accept_async(stream)
        .await
        .map_err(CodexRunError::AcceptCodex)
}

async fn open_agent_stream(
    tunnel_socket: &mut WebSocketStream<MaybeTlsStream<TcpStream>>,
) -> Result<(), CodexRunError> {
    let open_message = serde_json::json!({
        "type": "stream.open",
        "streamId": STREAM_ID,
        "channel": {
            "kind": "agent",
        },
    });
    tunnel_socket
        .send(Message::Text(open_message.to_string().into()))
        .await
        .map_err(CodexRunError::WriteTunnel)?;

    let open_result = timeout(STREAM_OPEN_TIMEOUT, wait_for_open_result(tunnel_socket))
        .await
        .map_err(|_| CodexRunError::OpenAgentStreamTimeout)??;

    match open_result {
        StreamOpenResult::Ok => Ok(()),
        StreamOpenResult::Error { code, message } => {
            Err(CodexRunError::OpenAgentStreamRejected { code, message })
        }
    }
}

async fn wait_for_open_result(
    tunnel_socket: &mut WebSocketStream<MaybeTlsStream<TcpStream>>,
) -> Result<StreamOpenResult, CodexRunError> {
    while let Some(message) = tunnel_socket.next().await {
        match message.map_err(CodexRunError::ReadTunnel)? {
            Message::Text(payload) => {
                let control: StreamControlMessage = serde_json::from_str(payload.as_str())
                    .map_err(CodexRunError::DecodeTunnelControl)?;
                match control {
                    StreamControlMessage::OpenOk {
                        stream_id: STREAM_ID,
                    } => return Ok(StreamOpenResult::Ok),
                    StreamControlMessage::OpenError {
                        stream_id: STREAM_ID,
                        code,
                        message,
                    } => return Ok(StreamOpenResult::Error { code, message }),
                    _ => {}
                }
            }
            Message::Ping(payload) => tunnel_socket
                .send(Message::Pong(payload))
                .await
                .map_err(CodexRunError::WriteTunnel)?,
            Message::Close(_) => {
                return Err(CodexRunError::ReadTunnel(
                    tokio_tungstenite::tungstenite::Error::ConnectionClosed,
                ));
            }
            Message::Binary(_) | Message::Pong(_) | Message::Frame(_) => {}
        }
    }

    Err(CodexRunError::ReadTunnel(
        tokio_tungstenite::tungstenite::Error::ConnectionClosed,
    ))
}

async fn bridge_codex_to_tunnel(
    mut codex_socket: WebSocketStream<TcpStream>,
    mut tunnel_socket: WebSocketStream<MaybeTlsStream<TcpStream>>,
) -> Result<(), CodexRunError> {
    let mut send_window_bytes = AGENT_STREAM_WINDOW_BYTES;

    loop {
        tokio::select! {
            codex_message = codex_socket.next() => {
                let Some(codex_message) = codex_message else {
                    send_stream_close(&mut tunnel_socket).await?;
                    return Ok(());
                };
                handle_codex_message(codex_message, &mut codex_socket, &mut tunnel_socket, &mut send_window_bytes).await?;
            }
            tunnel_message = tunnel_socket.next() => {
                let Some(tunnel_message) = tunnel_message else {
                    return Ok(());
                };
                if handle_tunnel_message(tunnel_message, &mut codex_socket, &mut tunnel_socket, &mut send_window_bytes).await? {
                    return Ok(());
                }
            }
        }
    }
}

async fn handle_codex_message(
    message: Result<Message, tokio_tungstenite::tungstenite::Error>,
    codex_socket: &mut WebSocketStream<TcpStream>,
    tunnel_socket: &mut WebSocketStream<MaybeTlsStream<TcpStream>>,
    send_window_bytes: &mut usize,
) -> Result<(), CodexRunError> {
    match message.map_err(CodexRunError::ReadCodex)? {
        Message::Text(payload) => {
            send_data_frame(
                tunnel_socket,
                PAYLOAD_KIND_WEBSOCKET_TEXT,
                payload.as_str().as_bytes(),
                send_window_bytes,
            )
            .await
        }
        Message::Binary(payload) => {
            send_data_frame(
                tunnel_socket,
                PAYLOAD_KIND_WEBSOCKET_BINARY,
                payload.as_ref(),
                send_window_bytes,
            )
            .await
        }
        Message::Close(_) => send_stream_close(tunnel_socket).await,
        Message::Ping(payload) => codex_socket
            .send(Message::Pong(payload))
            .await
            .map_err(CodexRunError::WriteCodex),
        Message::Pong(_) => Ok(()),
        Message::Frame(_) => Ok(()),
    }
}

async fn handle_tunnel_message(
    message: Result<Message, tokio_tungstenite::tungstenite::Error>,
    codex_socket: &mut WebSocketStream<TcpStream>,
    tunnel_socket: &mut WebSocketStream<MaybeTlsStream<TcpStream>>,
    send_window_bytes: &mut usize,
) -> Result<bool, CodexRunError> {
    match message.map_err(CodexRunError::ReadTunnel)? {
        Message::Binary(payload) => {
            let frame = decode_data_frame(payload.as_ref())?;
            if frame.stream_id != STREAM_ID {
                return Err(CodexRunError::DecodeDataFrame(
                    "received data frame for an unexpected stream id",
                ));
            }

            send_stream_window(tunnel_socket, frame.payload.len()).await?;
            match frame.payload_kind {
                PAYLOAD_KIND_WEBSOCKET_TEXT => {
                    let text =
                        String::from_utf8(frame.payload).map_err(CodexRunError::DecodeAgentText)?;
                    codex_socket
                        .send(Message::Text(text.into()))
                        .await
                        .map_err(CodexRunError::WriteCodex)?;
                }
                PAYLOAD_KIND_WEBSOCKET_BINARY => {
                    codex_socket
                        .send(Message::Binary(frame.payload.into()))
                        .await
                        .map_err(CodexRunError::WriteCodex)?;
                }
                _ => {
                    return Err(CodexRunError::DecodeDataFrame(
                        "received data frame with an unsupported payload kind",
                    ));
                }
            }
            Ok(false)
        }
        Message::Text(payload) => {
            let control: StreamControlMessage = serde_json::from_str(payload.as_str())
                .map_err(CodexRunError::DecodeTunnelControl)?;
            match control {
                StreamControlMessage::Window {
                    stream_id: STREAM_ID,
                    bytes,
                } => {
                    let next_send_window_bytes = (*send_window_bytes).checked_add(bytes).ok_or(
                        CodexRunError::DecodeDataFrame(
                            "sandbox agent stream send window exceeds the configured maximum",
                        ),
                    )?;
                    if next_send_window_bytes > AGENT_STREAM_WINDOW_BYTES {
                        return Err(CodexRunError::DecodeDataFrame(
                            "sandbox agent stream send window exceeds the configured maximum",
                        ));
                    }

                    *send_window_bytes = next_send_window_bytes;
                    Ok(false)
                }
                StreamControlMessage::Reset {
                    stream_id: STREAM_ID,
                    ..
                }
                | StreamControlMessage::Complete {
                    stream_id: STREAM_ID,
                }
                | StreamControlMessage::Close {
                    stream_id: STREAM_ID,
                } => {
                    codex_socket
                        .close(None)
                        .await
                        .map_err(CodexRunError::WriteCodex)?;
                    Ok(true)
                }
                _ => Err(CodexRunError::DecodeDataFrame(
                    "received unsupported control message for the agent stream",
                )),
            }
        }
        Message::Ping(payload) => {
            tunnel_socket
                .send(Message::Pong(payload))
                .await
                .map_err(CodexRunError::WriteTunnel)?;
            Ok(false)
        }
        Message::Pong(_) => Ok(false),
        Message::Close(_) => {
            codex_socket
                .close(None)
                .await
                .map_err(CodexRunError::WriteCodex)?;
            Ok(true)
        }
        Message::Frame(_) => Ok(false),
    }
}

async fn send_data_frame(
    tunnel_socket: &mut WebSocketStream<MaybeTlsStream<TcpStream>>,
    payload_kind: u8,
    payload: &[u8],
    send_window_bytes: &mut usize,
) -> Result<(), CodexRunError> {
    if payload.len() > *send_window_bytes {
        return Err(CodexRunError::SendWindowExhausted);
    }

    *send_window_bytes -= payload.len();
    let frame = encode_data_frame(STREAM_ID, payload_kind, payload)?;
    tunnel_socket
        .send(Message::Binary(frame.into()))
        .await
        .map_err(CodexRunError::WriteTunnel)
}

async fn send_stream_window(
    tunnel_socket: &mut WebSocketStream<MaybeTlsStream<TcpStream>>,
    bytes: usize,
) -> Result<(), CodexRunError> {
    if bytes == 0 {
        return Ok(());
    }

    let message = serde_json::json!({
        "type": "stream.window",
        "streamId": STREAM_ID,
        "bytes": bytes,
    });
    tunnel_socket
        .send(Message::Text(message.to_string().into()))
        .await
        .map_err(CodexRunError::WriteTunnel)
}

async fn send_stream_close(
    tunnel_socket: &mut WebSocketStream<MaybeTlsStream<TcpStream>>,
) -> Result<(), CodexRunError> {
    let message = serde_json::json!({
        "type": "stream.close",
        "streamId": STREAM_ID,
    });
    tunnel_socket
        .send(Message::Text(message.to_string().into()))
        .await
        .map_err(CodexRunError::WriteTunnel)
}

fn encode_data_frame(
    stream_id: u32,
    payload_kind: u8,
    payload: &[u8],
) -> Result<Vec<u8>, CodexRunError> {
    if stream_id == 0 {
        return Err(CodexRunError::DecodeDataFrame(
            "stream id must be greater than zero",
        ));
    }
    if payload_kind != PAYLOAD_KIND_WEBSOCKET_TEXT && payload_kind != PAYLOAD_KIND_WEBSOCKET_BINARY
    {
        return Err(CodexRunError::DecodeDataFrame(
            "payload kind is not supported",
        ));
    }

    let mut encoded = Vec::with_capacity(6 + payload.len());
    encoded.push(DATA_FRAME_KIND);
    encoded.extend_from_slice(&stream_id.to_be_bytes());
    encoded.push(payload_kind);
    encoded.extend_from_slice(payload);
    Ok(encoded)
}

fn decode_data_frame(encoded: &[u8]) -> Result<StreamDataFrame, CodexRunError> {
    if encoded.len() < 6 {
        return Err(CodexRunError::DecodeDataFrame(
            "data frame must be at least 6 bytes long",
        ));
    }
    if encoded[0] != DATA_FRAME_KIND {
        return Err(CodexRunError::DecodeDataFrame(
            "data frame kind is not supported",
        ));
    }

    let stream_id = u32::from_be_bytes([encoded[1], encoded[2], encoded[3], encoded[4]]);
    if stream_id == 0 {
        return Err(CodexRunError::DecodeDataFrame(
            "stream id must be greater than zero",
        ));
    }

    Ok(StreamDataFrame {
        stream_id,
        payload_kind: encoded[5],
        payload: encoded[6..].to_vec(),
    })
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct StreamDataFrame {
    stream_id: u32,
    payload_kind: u8,
    payload: Vec<u8>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
enum StreamOpenResult {
    Ok,
    Error { code: String, message: String },
}

#[derive(Debug, Deserialize)]
#[serde(tag = "type")]
enum StreamControlMessage {
    #[serde(rename = "stream.open.ok", rename_all = "camelCase")]
    OpenOk { stream_id: u32 },
    #[serde(rename = "stream.open.error", rename_all = "camelCase")]
    OpenError {
        stream_id: u32,
        code: String,
        message: String,
    },
    #[serde(rename = "stream.window", rename_all = "camelCase")]
    Window { stream_id: u32, bytes: usize },
    #[serde(rename = "stream.reset", rename_all = "camelCase")]
    Reset { stream_id: u32 },
    #[serde(rename = "stream.complete", rename_all = "camelCase")]
    Complete { stream_id: u32 },
    #[serde(rename = "stream.close", rename_all = "camelCase")]
    Close { stream_id: u32 },
}

#[cfg(test)]
mod tests {
    use crate::codex::{
        PAYLOAD_KIND_WEBSOCKET_BINARY, PAYLOAD_KIND_WEBSOCKET_TEXT, codex_command_args,
        decode_data_frame, encode_data_frame, render_local_codex_config, toml_string,
    };

    #[test]
    fn inserts_remote_before_interactive_codex_args() {
        assert_eq!(
            codex_command_args(
                "ws://127.0.0.1:1234",
                &["--model".to_owned(), "gpt-5.2".to_owned()]
            )
            .expect("codex args should be valid"),
            vec![
                "-c",
                "model_provider=\"mistle-remote\"",
                "-c",
                "model_providers.mistle-remote={ name = \"Mistle Remote\", base_url = \"http://127.0.0.1:1/v1\", wire_api = \"responses\", requires_openai_auth = false, supports_websockets = true }",
                "--remote",
                "ws://127.0.0.1:1234",
                "--model",
                "gpt-5.2",
            ]
        );
    }

    #[test]
    fn inserts_remote_after_resume_subcommand() {
        assert_eq!(
            codex_command_args(
                "ws://127.0.0.1:1234",
                &["resume".to_owned(), "thread_01".to_owned()]
            )
            .expect("codex args should be valid"),
            vec![
                "resume",
                "-c",
                "model_provider=\"mistle-remote\"",
                "-c",
                "model_providers.mistle-remote={ name = \"Mistle Remote\", base_url = \"http://127.0.0.1:1/v1\", wire_api = \"responses\", requires_openai_auth = false, supports_websockets = true }",
                "--remote",
                "ws://127.0.0.1:1234",
                "thread_01",
            ]
        );
    }

    #[test]
    fn rejects_user_supplied_remote_arg() {
        let error = codex_command_args("ws://127.0.0.1:1234", &["--remote".to_owned()])
            .expect_err("user supplied --remote should fail");

        assert_eq!(
            error.to_string(),
            "codex arguments must not include --remote; mistle manages the remote endpoint"
        );
    }

    #[test]
    fn renders_local_codex_config_with_no_auth_permissions_and_project_trust() {
        let config = render_local_codex_config().expect("local Codex config should render");

        assert!(config.contains("approval_policy = \"never\""));
        assert!(config.contains("sandbox_mode = \"danger-full-access\""));
        assert!(config.contains("trust_level = \"trusted\""));
    }

    #[test]
    fn escapes_toml_string_values() {
        assert_eq!(
            toml_string("path\\with\"quote\nnext"),
            "\"path\\\\with\\\"quote\\nnext\""
        );
    }

    #[test]
    fn encodes_and_decodes_websocket_text_data_frame() {
        let encoded = encode_data_frame(7, PAYLOAD_KIND_WEBSOCKET_TEXT, b"{\"jsonrpc\":\"2.0\"}")
            .expect("data frame should encode");

        assert_eq!(
            encoded,
            vec![
                0x01, 0x00, 0x00, 0x00, 0x07, 0x02, b'{', b'"', b'j', b's', b'o', b'n', b'r', b'p',
                b'c', b'"', b':', b'"', b'2', b'.', b'0', b'"', b'}',
            ]
        );
        assert_eq!(
            decode_data_frame(&encoded)
                .expect("data frame should decode")
                .payload_kind,
            PAYLOAD_KIND_WEBSOCKET_TEXT
        );
    }

    #[test]
    fn decodes_websocket_binary_data_frame() {
        let encoded = vec![0x01, 0x00, 0x00, 0x00, 0x09, 0x03, 0xaa, 0xbb];
        let decoded = decode_data_frame(&encoded).expect("data frame should decode");

        assert_eq!(decoded.stream_id, 9);
        assert_eq!(decoded.payload_kind, PAYLOAD_KIND_WEBSOCKET_BINARY);
        assert_eq!(decoded.payload, vec![0xaa, 0xbb]);
    }
}
