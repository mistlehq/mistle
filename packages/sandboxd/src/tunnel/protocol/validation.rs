//! Validation rules for tunnel protocol DTOs.
//!
//! Validation stays separate from parsing so tests and constructors can reuse
//! the same protocol constraints without going through JSON.

use super::*;

pub(super) fn validate_stream_id(stream_id: u32) -> Result<(), TunnelProtocolError> {
    if stream_id == 0 {
        return Err(TunnelProtocolError::new(
            "streamId must be an integer between 1 and 4294967295",
        ));
    }

    Ok(())
}

pub(super) fn validate_payload_kind(payload_kind: u8) -> Result<(), TunnelProtocolError> {
    match payload_kind {
        PAYLOAD_KIND_RAW_BYTES | PAYLOAD_KIND_WEBSOCKET_TEXT | PAYLOAD_KIND_WEBSOCKET_BINARY => {
            Ok(())
        }
        _ => Err(TunnelProtocolError::new(format!(
            "payloadKind is not supported: {payload_kind}"
        ))),
    }
}

pub(super) fn validate_agent_stream_open(
    message: &AgentStreamOpen,
) -> Result<(), TunnelProtocolError> {
    if message.message_type != "stream.open" {
        return Err(TunnelProtocolError::new(
            "agent stream.open request type must be 'stream.open'",
        ));
    }
    validate_stream_id(message.stream_id)?;
    if message.channel.kind != "agent" {
        return Err(TunnelProtocolError::new(
            "agent stream.open request channel.kind must be 'agent'",
        ));
    }

    Ok(())
}

pub(super) fn validate_processes_stream_open(
    message: &ProcessesStreamOpen,
) -> Result<(), TunnelProtocolError> {
    if message.message_type != "stream.open" {
        return Err(TunnelProtocolError::new(
            "processes stream.open request type must be 'stream.open'",
        ));
    }
    validate_stream_id(message.stream_id)?;
    if message.channel.kind != "processes" {
        return Err(TunnelProtocolError::new(
            "processes stream.open request channel.kind must be 'processes'",
        ));
    }

    Ok(())
}

pub(super) fn validate_file_upload_stream_open(
    message: &FileUploadStreamOpen,
) -> Result<(), TunnelProtocolError> {
    if message.message_type != "stream.open" {
        return Err(TunnelProtocolError::new(
            "file upload stream.open request type must be 'stream.open'",
        ));
    }
    validate_stream_id(message.stream_id)?;
    if message.channel.kind != "fileUpload" {
        return Err(TunnelProtocolError::new(
            "file upload stream.open request channel.kind must be 'fileUpload'",
        ));
    }
    if message.channel.thread_id.trim().is_empty() {
        return Err(TunnelProtocolError::new(
            "file upload stream.open request channel.threadId is required",
        ));
    }
    if message.channel.mime_type.trim().is_empty() {
        return Err(TunnelProtocolError::new(
            "file upload stream.open request channel.mimeType is required",
        ));
    }
    if message.channel.original_filename.trim().is_empty() {
        return Err(TunnelProtocolError::new(
            "file upload stream.open request channel.originalFilename is required",
        ));
    }
    if message.channel.size_bytes == 0 {
        return Err(TunnelProtocolError::new(
            "file upload stream.open request channel.sizeBytes must be a positive integer",
        ));
    }

    Ok(())
}

pub(super) fn validate_exec_stream_open(
    message: &ExecStreamOpen,
) -> Result<(), TunnelProtocolError> {
    if message.message_type != "stream.open" {
        return Err(TunnelProtocolError::new(
            "exec stream.open request type must be 'stream.open'",
        ));
    }
    validate_stream_id(message.stream_id)?;
    if message.channel.kind != "exec" {
        return Err(TunnelProtocolError::new(
            "exec stream.open request channel.kind must be 'exec'",
        ));
    }
    if message.channel.command.trim().is_empty() {
        return Err(TunnelProtocolError::new(
            "exec stream.open request channel.command is required",
        ));
    }
    if let Some(args) = message.channel.args.as_ref()
        && args.iter().any(|value| value.trim().is_empty())
    {
        return Err(TunnelProtocolError::new(
            "exec stream.open request args must contain only non-empty strings",
        ));
    }
    if matches!(message.channel.timeout_ms, Some(0)) {
        return Err(TunnelProtocolError::new(
            "exec stream.open request timeoutMs must be a positive integer",
        ));
    }
    if matches!(message.channel.max_output_bytes, Some(0)) {
        return Err(TunnelProtocolError::new(
            "exec stream.open request maxOutputBytes must be a positive integer",
        ));
    }

    Ok(())
}

pub(super) fn validate_file_search_stream_open(
    message: &FileSearchStreamOpen,
) -> Result<(), TunnelProtocolError> {
    if message.message_type != "stream.open" {
        return Err(TunnelProtocolError::new(
            "file search stream.open request type must be 'stream.open'",
        ));
    }
    validate_stream_id(message.stream_id)?;
    if message.channel.kind != "fileSearch" {
        return Err(TunnelProtocolError::new(
            "file search stream.open request channel.kind must be 'fileSearch'",
        ));
    }
    if message.channel.cwd.trim().is_empty() {
        return Err(TunnelProtocolError::new(
            "file search stream.open request channel.cwd is required",
        ));
    }

    Ok(())
}

pub(super) fn validate_file_search_query(
    message: &FileSearchQuery,
) -> Result<(), TunnelProtocolError> {
    if message.message_type != "fileSearch.query" {
        return Err(TunnelProtocolError::new(
            "fileSearch.query type must be 'fileSearch.query'",
        ));
    }
    if message.request_id.trim().is_empty() {
        return Err(TunnelProtocolError::new(
            "fileSearch.query requestId is required",
        ));
    }
    if matches!(message.limit, Some(0)) {
        return Err(TunnelProtocolError::new(
            "fileSearch.query limit must be a positive integer",
        ));
    }

    Ok(())
}

pub(super) fn validate_file_search_results(
    message: &FileSearchResults,
) -> Result<(), TunnelProtocolError> {
    if message.message_type != "fileSearch.results" {
        return Err(TunnelProtocolError::new(
            "fileSearch.results type must be 'fileSearch.results'",
        ));
    }
    if message.request_id.trim().is_empty() {
        return Err(TunnelProtocolError::new(
            "fileSearch.results requestId is required",
        ));
    }
    if message.items.iter().any(|item| item.path.trim().is_empty()) {
        return Err(TunnelProtocolError::new(
            "fileSearch.results items must contain only non-empty paths",
        ));
    }

    Ok(())
}

pub(super) fn validate_file_search_error(
    message: &FileSearchError,
) -> Result<(), TunnelProtocolError> {
    if message.message_type != "fileSearch.error" {
        return Err(TunnelProtocolError::new(
            "fileSearch.error type must be 'fileSearch.error'",
        ));
    }
    if message.request_id.trim().is_empty() {
        return Err(TunnelProtocolError::new(
            "fileSearch.error requestId is required",
        ));
    }
    if message.code.trim().is_empty() {
        return Err(TunnelProtocolError::new(
            "fileSearch.error code is required",
        ));
    }
    if message.message.trim().is_empty() {
        return Err(TunnelProtocolError::new(
            "fileSearch.error message is required",
        ));
    }

    Ok(())
}

pub(super) fn validate_file_search_select(
    message: &FileSearchSelect,
) -> Result<(), TunnelProtocolError> {
    if message.message_type != "fileSearch.select" {
        return Err(TunnelProtocolError::new(
            "fileSearch.select type must be 'fileSearch.select'",
        ));
    }
    if message.path.trim().is_empty() {
        return Err(TunnelProtocolError::new(
            "fileSearch.select path is required",
        ));
    }

    Ok(())
}

pub(super) fn validate_stream_signal(message: &PtyStreamSignal) -> Result<(), TunnelProtocolError> {
    if message.message_type != "stream.signal" {
        return Err(TunnelProtocolError::new(
            "stream.signal request type must be 'stream.signal'",
        ));
    }
    validate_stream_id(message.stream_id)?;
    if message.signal.signal_type != "pty.resize" {
        return Err(TunnelProtocolError::new(
            "stream.signal signal.type must be 'pty.resize'",
        ));
    }
    if message.signal.cols == 0 || message.signal.rows == 0 {
        return Err(TunnelProtocolError::new(
            "pty resize signal cols and rows must be greater than or equal to 1",
        ));
    }

    Ok(())
}

pub(super) fn validate_stream_close(message: &StreamClose) -> Result<(), TunnelProtocolError> {
    if message.message_type != "stream.close" {
        return Err(TunnelProtocolError::new(
            "stream.close request type must be 'stream.close'",
        ));
    }
    validate_stream_id(message.stream_id)?;
    Ok(())
}

pub(super) fn validate_stream_window(message: &StreamWindow) -> Result<(), TunnelProtocolError> {
    if message.message_type != "stream.window" {
        return Err(TunnelProtocolError::new(
            "stream.window request type must be 'stream.window'",
        ));
    }
    validate_stream_id(message.stream_id)?;
    if message.bytes == 0 {
        return Err(TunnelProtocolError::new(
            "stream.window bytes must be a positive integer",
        ));
    }
    Ok(())
}

pub(super) fn validate_port_access_target(
    target: &PortAccessTarget,
) -> Result<(), TunnelProtocolError> {
    if target.kind != "port" {
        return Err(TunnelProtocolError::new(format!(
            "ports target kind must be 'port', got '{}'",
            target.kind
        )));
    }
    if target.port == 0 {
        return Err(TunnelProtocolError::new(
            "ports target port must be greater than zero",
        ));
    }

    Ok(())
}

pub(super) fn validate_ports_target_authorize(
    message: &PortsTargetAuthorize,
) -> Result<(), TunnelProtocolError> {
    if message.message_type != "ports.target.authorize" {
        return Err(TunnelProtocolError::new(format!(
            "ports.target.authorize message type must be 'ports.target.authorize', got '{}'",
            message.message_type
        )));
    }
    if message.request_id.trim().is_empty() {
        return Err(TunnelProtocolError::new(
            "ports.target.authorize requestId is required",
        ));
    }
    validate_port_access_target(&message.target)
}

pub(super) fn validate_repeated_header_values(
    headers: &RepeatedHeaderValues,
    field_name: &str,
) -> Result<(), TunnelProtocolError> {
    for header_name in headers.keys() {
        if header_name.trim().is_empty() {
            return Err(TunnelProtocolError::new(format!(
                "{field_name} header names must be non-empty",
            )));
        }
    }

    Ok(())
}

pub(super) fn validate_tcp_upstream_protocol(
    message_type: &str,
    upstream_protocol: &str,
) -> Result<(), TunnelProtocolError> {
    if upstream_protocol != "http" && upstream_protocol != "https" {
        return Err(TunnelProtocolError::new(format!(
            "{message_type} upstreamProtocol must be 'http' or 'https', got '{upstream_protocol}'"
        )));
    }

    Ok(())
}

pub(super) fn validate_ports_tcp_open(message: &PortsTcpOpen) -> Result<(), TunnelProtocolError> {
    if message.message_type != "ports.tcp.open" {
        return Err(TunnelProtocolError::new(format!(
            "ports.tcp.open message type must be 'ports.tcp.open', got '{}'",
            message.message_type
        )));
    }
    validate_stream_id(message.stream_id)?;
    validate_port_access_target(&message.target)?;
    validate_tcp_upstream_protocol("ports.tcp.open", &message.upstream_protocol)
}

pub(super) fn validate_ports_tcp_connected(
    message: &PortsTcpConnected,
) -> Result<(), TunnelProtocolError> {
    if message.message_type != "ports.tcp.connected" {
        return Err(TunnelProtocolError::new(format!(
            "ports.tcp.connected message type must be 'ports.tcp.connected', got '{}'",
            message.message_type
        )));
    }
    validate_stream_id(message.stream_id)
}

pub(super) fn validate_ports_tcp_close(message: &PortsTcpClose) -> Result<(), TunnelProtocolError> {
    if message.message_type != "ports.tcp.close" {
        return Err(TunnelProtocolError::new(format!(
            "ports.tcp.close message type must be 'ports.tcp.close', got '{}'",
            message.message_type
        )));
    }
    validate_stream_id(message.stream_id)?;
    if message.direction != "request" && message.direction != "response" {
        return Err(TunnelProtocolError::new(format!(
            "ports.tcp.close direction must be 'request' or 'response', got '{}'",
            message.direction
        )));
    }

    Ok(())
}

pub(super) fn validate_ports_tcp_error(message: &PortsTcpError) -> Result<(), TunnelProtocolError> {
    if message.message_type != "ports.tcp.error" {
        return Err(TunnelProtocolError::new(format!(
            "ports.tcp.error message type must be 'ports.tcp.error', got '{}'",
            message.message_type
        )));
    }
    validate_stream_id(message.stream_id)?;
    if message.code != "upstream_connect_failed"
        && message.code != "upstream_handshake_failed"
        && message.code != "upstream_io_error"
    {
        return Err(TunnelProtocolError::new(format!(
            "ports.tcp.error code is invalid: '{}'",
            message.code
        )));
    }
    if message.message.trim().is_empty() {
        return Err(TunnelProtocolError::new(
            "ports.tcp.error message is required",
        ));
    }

    Ok(())
}

pub(super) fn validate_ports_http_open(message: &PortsHttpOpen) -> Result<(), TunnelProtocolError> {
    if message.message_type != "ports.http.open" {
        return Err(TunnelProtocolError::new(format!(
            "ports.http.open message type must be 'ports.http.open', got '{}'",
            message.message_type
        )));
    }
    validate_port_access_target(&message.target)?;
    validate_tcp_upstream_protocol("ports.http.open", &message.upstream_protocol)?;
    if message.request.method.trim().is_empty() {
        return Err(TunnelProtocolError::new(
            "ports.http.open request method is required",
        ));
    }
    if message.request.path.trim().is_empty() {
        return Err(TunnelProtocolError::new(
            "ports.http.open request path is required",
        ));
    }
    if message
        .request
        .query
        .as_ref()
        .is_some_and(|query| query.trim().is_empty())
    {
        return Err(TunnelProtocolError::new(
            "ports.http.open request query must be non-empty when present",
        ));
    }
    validate_repeated_header_values(&message.request.headers, "ports.http.open request")
}

pub(super) fn validate_ports_http_response_start(
    message: &PortsHttpResponseStart,
) -> Result<(), TunnelProtocolError> {
    if message.message_type != "ports.http.response.start" {
        return Err(TunnelProtocolError::new(format!(
            "ports.http.response.start message type must be 'ports.http.response.start', got '{}'",
            message.message_type
        )));
    }
    if !(200..=599).contains(&message.status) {
        return Err(TunnelProtocolError::new(
            "ports.http.response.start status must be between 200 and 599",
        ));
    }
    validate_repeated_header_values(&message.headers, "ports.http.response.start")
}

pub(super) fn validate_ports_http_body_chunk(
    message: &PortsHttpBodyChunk,
) -> Result<(), TunnelProtocolError> {
    if message.message_type != "ports.http.body.chunk" {
        return Err(TunnelProtocolError::new(format!(
            "ports.http.body.chunk message type must be 'ports.http.body.chunk', got '{}'",
            message.message_type
        )));
    }
    if message.direction != "request" && message.direction != "response" {
        return Err(TunnelProtocolError::new(format!(
            "ports.http.body.chunk direction must be 'request' or 'response', got '{}'",
            message.direction
        )));
    }
    if message.encoding != "base64" {
        return Err(TunnelProtocolError::new(format!(
            "ports.http.body.chunk encoding must be 'base64', got '{}'",
            message.encoding
        )));
    }

    Ok(())
}

pub(super) fn validate_ports_http_body_end(
    message: &PortsHttpBodyEnd,
) -> Result<(), TunnelProtocolError> {
    if message.message_type != "ports.http.body.end" {
        return Err(TunnelProtocolError::new(format!(
            "ports.http.body.end message type must be 'ports.http.body.end', got '{}'",
            message.message_type
        )));
    }
    if message.direction != "request" && message.direction != "response" {
        return Err(TunnelProtocolError::new(format!(
            "ports.http.body.end direction must be 'request' or 'response', got '{}'",
            message.direction
        )));
    }

    Ok(())
}

pub(super) fn validate_ports_stream_close(
    message: &PortsStreamClose,
) -> Result<(), TunnelProtocolError> {
    if message.message_type != "ports.stream.close" {
        return Err(TunnelProtocolError::new(format!(
            "ports.stream.close message type must be 'ports.stream.close', got '{}'",
            message.message_type
        )));
    }

    Ok(())
}

pub(super) fn validate_ports_stream_error(
    message: &PortsStreamError,
) -> Result<(), TunnelProtocolError> {
    if message.message_type != "ports.stream.error" {
        return Err(TunnelProtocolError::new(format!(
            "ports.stream.error message type must be 'ports.stream.error', got '{}'",
            message.message_type
        )));
    }
    if message.code != "upstream_connect_failed"
        && message.code != "upstream_handshake_failed"
        && message.code != "upstream_io_error"
    {
        return Err(TunnelProtocolError::new(format!(
            "ports.stream.error code is invalid: '{}'",
            message.code
        )));
    }
    if message.message.trim().is_empty() {
        return Err(TunnelProtocolError::new(
            "ports.stream.error message is required",
        ));
    }

    Ok(())
}

pub(super) fn validate_telemetry_open_ok(
    message: &TelemetryOpenOk,
) -> Result<(), TunnelProtocolError> {
    if message.message_type != "telemetry.open.ok" {
        return Err(TunnelProtocolError::new(
            "telemetry.open.ok response type must be 'telemetry.open.ok'",
        ));
    }
    validate_stream_id(message.stream_id)?;
    if message.initial_window_bytes == 0 {
        return Err(TunnelProtocolError::new(
            "telemetry.open.ok initialWindowBytes must be a positive integer",
        ));
    }
    Ok(())
}

pub(super) fn validate_telemetry_open_error(
    message: &TelemetryOpenError,
) -> Result<(), TunnelProtocolError> {
    if message.message_type != "telemetry.open.error" {
        return Err(TunnelProtocolError::new(
            "telemetry.open.error response type must be 'telemetry.open.error'",
        ));
    }
    validate_stream_id(message.stream_id)?;
    if message.code.trim().is_empty() {
        return Err(TunnelProtocolError::new(
            "telemetry.open.error code is required",
        ));
    }
    if message.message.trim().is_empty() {
        return Err(TunnelProtocolError::new(
            "telemetry.open.error message is required",
        ));
    }
    Ok(())
}

pub(super) fn validate_telemetry_window(
    message: &TelemetryWindow,
) -> Result<(), TunnelProtocolError> {
    if message.message_type != "telemetry.window" {
        return Err(TunnelProtocolError::new(
            "telemetry.window response type must be 'telemetry.window'",
        ));
    }
    validate_stream_id(message.stream_id)?;
    if message.bytes == 0 {
        return Err(TunnelProtocolError::new(
            "telemetry.window bytes must be a positive integer",
        ));
    }
    Ok(())
}

pub(super) fn validate_telemetry_reset(
    message: &TelemetryReset,
) -> Result<(), TunnelProtocolError> {
    if message.message_type != "telemetry.reset" {
        return Err(TunnelProtocolError::new(
            "telemetry.reset response type must be 'telemetry.reset'",
        ));
    }
    validate_stream_id(message.stream_id)?;
    if message.code.trim().is_empty() {
        return Err(TunnelProtocolError::new("telemetry.reset code is required"));
    }
    if message.message.trim().is_empty() {
        return Err(TunnelProtocolError::new(
            "telemetry.reset message is required",
        ));
    }
    Ok(())
}

pub(super) fn validate_signing_request(
    message: &SigningRequest,
) -> Result<(), TunnelProtocolError> {
    if message.message_type != "signing.request" {
        return Err(TunnelProtocolError::new(
            "signing.request message type must be 'signing.request'",
        ));
    }
    if message.request_id.trim().is_empty() {
        return Err(TunnelProtocolError::new(
            "signing.request requestId is required",
        ));
    }
    if message.organization_id.trim().is_empty() {
        return Err(TunnelProtocolError::new(
            "signing.request organizationId is required",
        ));
    }
    if message.sandbox_instance_id.trim().is_empty() {
        return Err(TunnelProtocolError::new(
            "signing.request sandboxInstanceId is required",
        ));
    }
    if message.acting_user_id.trim().is_empty() {
        return Err(TunnelProtocolError::new(
            "signing.request actingUserId is required",
        ));
    }
    if message.provider_family.trim().is_empty() {
        return Err(TunnelProtocolError::new(
            "signing.request providerFamily is required",
        ));
    }
    if message
        .integration_connection_id
        .as_ref()
        .is_some_and(|integration_connection_id| integration_connection_id.trim().is_empty())
    {
        return Err(TunnelProtocolError::new(
            "signing.request integrationConnectionId cannot be empty when provided",
        ));
    }
    if message.format.trim().is_empty() {
        return Err(TunnelProtocolError::new(
            "signing.request format is required",
        ));
    }
    if message.key_ref.trim().is_empty() {
        return Err(TunnelProtocolError::new(
            "signing.request keyRef is required",
        ));
    }
    if message.grant.trim().is_empty() {
        return Err(TunnelProtocolError::new(
            "signing.request grant is required",
        ));
    }
    if message.encoding != "base64" {
        return Err(TunnelProtocolError::new(
            "signing.request encoding must be 'base64'",
        ));
    }
    Ok(())
}

pub(super) fn validate_signing_success_result(
    message: &SigningSuccessResult,
) -> Result<(), TunnelProtocolError> {
    if message.message_type != "signing.result" {
        return Err(TunnelProtocolError::new(
            "signing.result message type must be 'signing.result'",
        ));
    }
    if !message.ok {
        return Err(TunnelProtocolError::new(
            "successful signing.result payload must set ok=true",
        ));
    }
    if message.request_id.trim().is_empty() {
        return Err(TunnelProtocolError::new(
            "signing.result requestId is required",
        ));
    }
    if message.encoding != "base64" {
        return Err(TunnelProtocolError::new(
            "successful signing.result encoding must be 'base64'",
        ));
    }
    Ok(())
}

pub(super) fn validate_signing_failure_result(
    message: &SigningFailureResult,
) -> Result<(), TunnelProtocolError> {
    if message.message_type != "signing.result" {
        return Err(TunnelProtocolError::new(
            "signing.result message type must be 'signing.result'",
        ));
    }
    if message.ok {
        return Err(TunnelProtocolError::new(
            "failed signing.result payload must set ok=false",
        ));
    }
    if message.request_id.trim().is_empty() {
        return Err(TunnelProtocolError::new(
            "signing.result requestId is required",
        ));
    }
    if message.code.trim().is_empty() {
        return Err(TunnelProtocolError::new("signing.result code is required"));
    }
    if message.message.trim().is_empty() {
        return Err(TunnelProtocolError::new(
            "signing.result message is required",
        ));
    }
    Ok(())
}

pub(super) fn validate_egress_token_request(
    message: &EgressTokenRequest,
) -> Result<(), TunnelProtocolError> {
    if message.message_type != "egress.token.request" {
        return Err(TunnelProtocolError::new(
            "egress.token.request message type must be 'egress.token.request'",
        ));
    }
    if message.request_id.trim().is_empty() {
        return Err(TunnelProtocolError::new(
            "egress.token.request requestId is required",
        ));
    }
    if let Some(acting_user_id) = &message.acting_user_id
        && acting_user_id.trim().is_empty()
    {
        return Err(TunnelProtocolError::new(
            "egress.token.request actingUserId must not be empty when present",
        ));
    }
    Ok(())
}

pub(super) fn validate_egress_token_response(
    message: &EgressTokenResponse,
) -> Result<(), TunnelProtocolError> {
    if message.message_type != "egress.token.response" {
        return Err(TunnelProtocolError::new(
            "egress.token.response message type must be 'egress.token.response'",
        ));
    }
    if message.request_id.trim().is_empty() {
        return Err(TunnelProtocolError::new(
            "egress.token.response requestId is required",
        ));
    }
    if message.token.trim().is_empty() {
        return Err(TunnelProtocolError::new(
            "egress.token.response token is required",
        ));
    }
    if message.expires_at.trim().is_empty() {
        return Err(TunnelProtocolError::new(
            "egress.token.response expiresAt is required",
        ));
    }
    if message.ttl_ms == 0 {
        return Err(TunnelProtocolError::new(
            "egress.token.response ttlMs must be positive",
        ));
    }
    Ok(())
}

pub(super) fn validate_egress_token_error(
    message: &EgressTokenError,
) -> Result<(), TunnelProtocolError> {
    if message.message_type != "egress.token.error" {
        return Err(TunnelProtocolError::new(
            "egress.token.error message type must be 'egress.token.error'",
        ));
    }
    if message.request_id.trim().is_empty() {
        return Err(TunnelProtocolError::new(
            "egress.token.error requestId is required",
        ));
    }
    if message.code != "invalid_sandbox_state" && message.code != "internal_error" {
        return Err(TunnelProtocolError::new(
            "egress.token.error code is invalid",
        ));
    }
    if message.message.trim().is_empty() {
        return Err(TunnelProtocolError::new(
            "egress.token.error message is required",
        ));
    }
    Ok(())
}

pub(super) fn validate_pty_session_launch(
    launch: &PtySessionLaunch,
) -> Result<(), TunnelProtocolError> {
    if launch.cols.is_some() != launch.rows.is_some() {
        return Err(TunnelProtocolError::new(
            "pty.session.open launch cols and rows must both be provided when either is set",
        ));
    }
    if matches!(launch.cols, Some(0)) || matches!(launch.rows, Some(0)) {
        return Err(TunnelProtocolError::new(
            "pty.session.open launch cols and rows must be greater than or equal to 1",
        ));
    }
    if let Some(command) = launch.command.as_ref()
        && command.trim().is_empty()
    {
        return Err(TunnelProtocolError::new(
            "pty.session.open launch command must be a non-empty string",
        ));
    }
    if let Some(args) = launch.args.as_ref()
        && args.iter().any(|value| value.trim().is_empty())
    {
        return Err(TunnelProtocolError::new(
            "pty.session.open launch args must contain only non-empty strings",
        ));
    }

    Ok(())
}

pub(super) fn validate_pty_session_open(
    message: &PtySessionOpen,
) -> Result<(), TunnelProtocolError> {
    if message.message_type != "pty.session.open" {
        return Err(TunnelProtocolError::new(
            "pty.session.open message type must be 'pty.session.open'",
        ));
    }
    if message.request_id.trim().is_empty() {
        return Err(TunnelProtocolError::new(
            "pty.session.open requestId is required",
        ));
    }
    if message.pty_session_id.trim().is_empty() {
        return Err(TunnelProtocolError::new(
            "pty.session.open ptySessionId is required",
        ));
    }
    if !message.transport_url.starts_with("ws://") && !message.transport_url.starts_with("wss://") {
        return Err(TunnelProtocolError::new(
            "pty.session.open transportUrl must use ws or wss",
        ));
    }
    if message.transport_token.trim().is_empty() {
        return Err(TunnelProtocolError::new(
            "pty.session.open transportToken is required",
        ));
    }
    validate_pty_session_launch(&message.launch)?;
    Ok(())
}

pub(super) fn validate_pty_session_opened(
    message: &PtySessionOpened,
) -> Result<(), TunnelProtocolError> {
    if message.message_type != "pty.session.opened" {
        return Err(TunnelProtocolError::new(
            "pty.session.opened message type must be 'pty.session.opened'",
        ));
    }
    if message.request_id.trim().is_empty() {
        return Err(TunnelProtocolError::new(
            "pty.session.opened requestId is required",
        ));
    }
    if message.pty_session_id.trim().is_empty() {
        return Err(TunnelProtocolError::new(
            "pty.session.opened ptySessionId is required",
        ));
    }
    Ok(())
}

pub(super) fn validate_pty_session_error(
    message: &PtySessionError,
) -> Result<(), TunnelProtocolError> {
    if message.message_type != "pty.session.error" {
        return Err(TunnelProtocolError::new(
            "pty.session.error message type must be 'pty.session.error'",
        ));
    }
    if message.request_id.trim().is_empty() {
        return Err(TunnelProtocolError::new(
            "pty.session.error requestId is required",
        ));
    }
    if message.pty_session_id.trim().is_empty() {
        return Err(TunnelProtocolError::new(
            "pty.session.error ptySessionId is required",
        ));
    }
    if message.code != "transport_connect_failed"
        && message.code != "pty_create_failed"
        && message.code != "pty_attach_failed"
        && message.code != "internal_error"
    {
        return Err(TunnelProtocolError::new(
            "pty.session.error code is invalid",
        ));
    }
    if message.message.trim().is_empty() {
        return Err(TunnelProtocolError::new(
            "pty.session.error message is required",
        ));
    }
    Ok(())
}
