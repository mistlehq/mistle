//! JSON control-message serialization for the tunnel protocol.
//!
//! Session code uses these helpers to build outbound protocol messages with
//! consistent field names and reset-code formatting.

use super::*;

/// Builds one `stream.open.ok` response payload.
pub fn stream_open_ok(stream_id: u32) -> String {
    serialize_json(&StreamOpenOk {
        message_type: "stream.open.ok",
        stream_id,
    })
}

/// Builds one `stream.open.error` response payload.
pub fn stream_open_error(stream_id: u32, code: &'static str, message: impl Into<String>) -> String {
    serialize_json(&StreamOpenError {
        message_type: "stream.open.error",
        stream_id,
        code,
        message: message.into(),
    })
}

/// Builds one `stream.reset` response payload.
pub fn stream_reset(stream_id: u32, code: &'static str, message: impl Into<String>) -> String {
    serialize_json(&StreamReset {
        message_type: "stream.reset",
        stream_id,
        code,
        message: message.into(),
    })
}

/// Builds one `stream.window` response payload.
pub fn stream_window(stream_id: u32, bytes: usize) -> String {
    serialize_json(&StreamWindowResponse {
        message_type: "stream.window",
        stream_id,
        bytes,
    })
}

/// Builds one `stream.complete` response payload.
pub fn stream_complete(stream_id: u32) -> String {
    serialize_json(&StreamComplete {
        message_type: "stream.complete",
        stream_id,
    })
}

/// Builds one outbound `signing.request` payload.
pub fn signing_request(request: &SigningRequest) -> String {
    serialize_json(request)
}

/// Builds one outbound `egress.token.request` payload.
pub fn egress_token_request(request: &EgressTokenRequest) -> String {
    serialize_json(request)
}

/// Builds one successful `ports.target.authorize.result` payload.
pub fn ports_target_authorize_success_result(
    request_id: &str,
    upstream_protocol: &str,
    websocket_capable: bool,
) -> String {
    serialize_json(&PortsTargetAuthorizeSuccessResult {
        message_type: "ports.target.authorize.result".to_string(),
        request_id: request_id.to_string(),
        authorized: true,
        upstream_protocol: upstream_protocol.to_string(),
        websocket_capable,
    })
}

/// Builds one failed `ports.target.authorize.result` payload.
pub fn ports_target_authorize_failure_result(request_id: &str, reason: &str) -> String {
    serialize_json(&PortsTargetAuthorizeFailureResult {
        message_type: "ports.target.authorize.result".to_string(),
        request_id: request_id.to_string(),
        authorized: false,
        reason: reason.to_string(),
    })
}

/// Builds one `stream.event` PTY exit payload.
pub fn pty_exit_event(stream_id: u32, exit_code: i32) -> String {
    serialize_json(&StreamEvent {
        message_type: "stream.event",
        stream_id,
        event: PtyExitEvent {
            message_type: "pty.exit",
            exit_code,
        },
    })
}

/// Builds one `pty.session.opened` response payload.
pub fn pty_session_opened(request_id: &str, pty_session_id: &str) -> String {
    serialize_json(&PtySessionOpenedResponse {
        message_type: "pty.session.opened",
        request_id,
        pty_session_id,
    })
}

/// Builds one `pty.session.error` response payload.
pub fn pty_session_error(
    request_id: &str,
    pty_session_id: &str,
    code: &'static str,
    message: impl Into<String>,
) -> String {
    serialize_json(&PtySessionErrorResponse {
        message_type: "pty.session.error",
        request_id,
        pty_session_id,
        code,
        message: message.into(),
    })
}

/// Builds one `stream.event` file-upload completion payload.
pub fn file_upload_completed_event(input: FileUploadCompletedEventInput<'_>) -> String {
    serialize_json(&StreamEvent {
        message_type: "stream.event",
        stream_id: input.stream_id,
        event: FileUploadCompletedEvent {
            message_type: "fileUpload.completed",
            kind: input.kind,
            attachment_id: input.attachment_id,
            thread_id: input.thread_id,
            original_filename: input.original_filename,
            mime_type: input.mime_type,
            size_bytes: input.size_bytes,
            path: input.path,
        },
    })
}

/// Builds one `stream.event` exec result payload.
pub fn exec_result_event(
    stream_id: u32,
    exit_code: i32,
    stdout: &str,
    stderr: &str,
    truncated: bool,
) -> String {
    serialize_json(&StreamEvent {
        message_type: "stream.event",
        stream_id,
        event: ExecResultEvent {
            message_type: "exec.result",
            exit_code,
            stdout,
            stderr,
            truncated,
        },
    })
}

/// Builds one `telemetry.open` request payload.
pub fn telemetry_open(stream_id: u32, signal: &str, format: &str) -> String {
    serialize_json(&TelemetryOpen {
        message_type: "telemetry.open".to_string(),
        stream_id,
        signal: signal.to_string(),
        format: format.to_string(),
    })
}

/// Builds one `telemetry.close` request payload.
pub fn telemetry_close(stream_id: u32) -> String {
    serialize_json(&TelemetryClose {
        message_type: "telemetry.close".to_string(),
        stream_id,
    })
}

pub(super) fn serialize_json<T>(value: &T) -> String
where
    T: Serialize,
{
    serde_json::to_string(value).expect("tunnel protocol payload should serialize")
}
