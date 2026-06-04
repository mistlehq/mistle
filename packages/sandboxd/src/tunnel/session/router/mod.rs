//! Bootstrap message, request, and stream routing for the live tunnel session.

use std::fs;
use std::io::Write;
use std::time::Instant;

use futures_util::{SinkExt, StreamExt};
use serde_json::Value;
use tokio::sync::mpsc;
use tokio::task::JoinHandle as TokioJoinHandle;
use tokio_tungstenite::connect_async;
use tokio_tungstenite::tungstenite::{Error as WebSocketError, Message};
use url::Url;

use crate::protocol::session::SessionRuntimeInput;
use crate::supervision::SupervisedComponent;
use crate::time::Clock;
use crate::tunnel::file_search::{FileSearchWorkerCommand, spawn_file_search_worker};
use crate::tunnel::port_access_transport::{PortAccessTcpCommand, PortAccessTransportEvent};
use crate::tunnel::protocol::{
    CONNECT_ERROR_CODE_AGENT_ENDPOINT_DIAL_FAILED, CONNECT_ERROR_CODE_INVALID_CONNECT_REQUEST,
    FILE_UPLOAD_RESET_CODE_BYTE_COUNT_EXCEEDED, PAYLOAD_KIND_RAW_BYTES,
    PAYLOAD_KIND_WEBSOCKET_TEXT, STREAM_RESET_CODE_EXEC_COMMAND_FAILED,
    STREAM_RESET_CODE_INVALID_STREAM_CLOSE, STREAM_RESET_CODE_INVALID_STREAM_DATA,
    STREAM_RESET_CODE_INVALID_STREAM_SIGNAL, STREAM_RESET_CODE_INVALID_STREAM_WINDOW,
    STREAM_RESET_CODE_TARGET_CLOSED, StreamControlMessage, decode_stream_data_frame,
    exec_result_event, parse_egress_token_control_message, parse_file_search_stream_message,
    parse_ports_control_message, parse_ports_transport_message, parse_pty_session_control_message,
    parse_signing_control_message, parse_stream_control_message, stream_complete,
    stream_open_error, stream_open_ok, stream_reset, stream_window,
};
use crate::tunnel::session::TunnelSessionError;
use crate::tunnel::session::agent::{
    add_agent_stream_window_credit, create_agent_stream, forward_gateway_frame_to_agent,
    handle_agent_runtime_message,
};
use crate::tunnel::session::bootstrap::{
    TunnelWebSocket, TunnelWriterMessage, record_bootstrap_tunnel_diagnostic_event,
    send_telemetry_frames, write_tunnel_pong, write_tunnel_text,
};
use crate::tunnel::session::egress::{
    handle_egress_token_control_message, handle_egress_token_session_request,
};
use crate::tunnel::session::exec::{
    PendingExecOpenState, cancel_pending_exec_open, spawn_exec_task,
};
use crate::tunnel::session::file_search::{
    FILE_SEARCH_CLOSE_SOURCE_GATEWAY, FILE_SEARCH_CLOSE_SOURCE_SANDBOXD,
    FILE_SEARCH_EVENT_STREAM_OPENED, FILE_SEARCH_OUTCOME_CLOSED, FILE_SEARCH_OUTCOME_RESET,
    FILE_SEARCH_STREAM_CHANNEL_KIND, FileSearchStreamCloseTelemetry, FileSearchStreamState,
    close_file_search_stream, handle_file_search_worker_event, send_file_search_command,
};
use crate::tunnel::session::file_upload::{create_file_upload_state, finalize_file_upload};
use crate::tunnel::session::lifecycle::{
    report_dropped_bootstrap_binary_frame, report_dropped_bootstrap_text_message,
    set_runtime_agent_endpoint_url, set_runtime_environment, update_tunnel_supervision_details,
};
use crate::tunnel::session::operation::{
    close_operation_stream, enqueue_operation_record, flush_pending_operation_records,
    handle_operation_control_message,
};
use crate::tunnel::session::port_access::{
    close_port_access_tcp_streams, handle_port_access_tcp_data_frame,
    handle_port_access_transport_event, handle_ports_control_message,
    handle_ports_transport_message, port_access_stream_is_active,
};
use crate::tunnel::session::process::{
    add_process_stream_window, close_process_stream, handle_process_stream_frame,
    open_process_stream, poll_process_streams, reset_process_streams,
};
use crate::tunnel::session::pty::handle_pty_session_control_message;
use crate::tunnel::session::signing::{
    handle_signing_control_message, handle_signing_session_request,
};
use crate::tunnel::session::state::{
    PendingAgentOpenState, TunnelSessionControlFlow, TunnelSessionEvent, TunnelSessionLoopContext,
    TunnelSessionMutableState, TunnelSessionRequest, TunnelSessionRuntime, continue_with,
};
use crate::tunnel::session::telemetry::{
    AGENT_STREAM_CLOSE_SOURCE_GATEWAY, AGENT_STREAM_CLOSE_SOURCE_RUNTIME,
    AGENT_STREAM_OUTCOME_CLOSED, AGENT_STREAM_OUTCOME_RESET, AgentStreamTermination,
    publish_bootstrap_closed_agent_stream_summaries, publish_tunnel_telemetry_log,
    remove_agent_stream_and_publish_summary,
};
use crate::tunnel::telemetry::SandboxTelemetryLogLevel;

mod control;
mod event;
mod frame;
mod request;
mod task;

use task::{spawn_agent_dial_task, spawn_agent_stream_task};

pub(in crate::tunnel::session) use control::{
    handle_tunnel_control_message, tunnel_stream_is_active,
};
pub(in crate::tunnel::session) use event::handle_tunnel_session_event;
pub(in crate::tunnel::session) use frame::handle_tunnel_binary_frame;
pub(in crate::tunnel::session) use request::{
    derive_startup_operation_id, handle_tunnel_session_request, startup_operation_kind,
};
pub(in crate::tunnel::session) use task::spawn_port_access_transport_event_sender;
