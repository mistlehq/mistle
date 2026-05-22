//! JSON control-message parsing for the tunnel protocol.
//!
//! This module converts inbound websocket text payloads into typed control
//! messages before router code mutates session state.

use super::*;

/// Parses one inbound stream control frame from a websocket text payload.
pub fn parse_stream_control_message(
    payload: &str,
) -> Result<StreamControlMessage, TunnelProtocolError> {
    let parsed_payload: serde_json::Value = serde_json::from_str(payload).map_err(|error| {
        TunnelProtocolError::new(format!("control message must be valid json: {error}"))
    })?;
    let message_type = parsed_payload
        .get("type")
        .and_then(serde_json::Value::as_str)
        .ok_or_else(|| TunnelProtocolError::new("control message type is required"))?;

    match message_type {
        "stream.open" => {
            let channel_kind = parsed_payload
                .get("channel")
                .and_then(|channel| channel.get("kind"))
                .and_then(serde_json::Value::as_str)
                .ok_or_else(|| {
                    TunnelProtocolError::new("stream.open request channel.kind is required")
                })?;

            match channel_kind {
                "agent" => {
                    let message: AgentStreamOpen = serde_json::from_value(parsed_payload)
                        .map_err(|error| TunnelProtocolError::new(error.to_string()))?;
                    validate_agent_stream_open(&message)?;
                    Ok(StreamControlMessage::OpenAgent(message))
                }
                "processes" => {
                    let message: ProcessesStreamOpen = serde_json::from_value(parsed_payload)
                        .map_err(|error| TunnelProtocolError::new(error.to_string()))?;
                    validate_processes_stream_open(&message)?;
                    Ok(StreamControlMessage::OpenProcesses(message))
                }
                "fileUpload" => {
                    let message: FileUploadStreamOpen = serde_json::from_value(parsed_payload)
                        .map_err(|error| TunnelProtocolError::new(error.to_string()))?;
                    validate_file_upload_stream_open(&message)?;
                    Ok(StreamControlMessage::OpenFileUpload(message))
                }
                "exec" => {
                    let message: ExecStreamOpen = serde_json::from_value(parsed_payload)
                        .map_err(|error| TunnelProtocolError::new(error.to_string()))?;
                    validate_exec_stream_open(&message)?;
                    Ok(StreamControlMessage::OpenExec(message))
                }
                "fileSearch" => {
                    let message: FileSearchStreamOpen = serde_json::from_value(parsed_payload)
                        .map_err(|error| TunnelProtocolError::new(error.to_string()))?;
                    validate_file_search_stream_open(&message)?;
                    Ok(StreamControlMessage::OpenFileSearch(message))
                }
                _ => Err(TunnelProtocolError::new(format!(
                    "stream.open request channel.kind '{channel_kind}' is not supported"
                ))),
            }
        }
        "stream.signal" => {
            let message: PtyStreamSignal = serde_json::from_value(parsed_payload)
                .map_err(|error| TunnelProtocolError::new(error.to_string()))?;
            validate_stream_signal(&message)?;
            Ok(StreamControlMessage::Signal(message))
        }
        "stream.close" => {
            let message: StreamClose = serde_json::from_value(parsed_payload)
                .map_err(|error| TunnelProtocolError::new(error.to_string()))?;
            validate_stream_close(&message)?;
            Ok(StreamControlMessage::Close(message))
        }
        "stream.window" => {
            let message: StreamWindow = serde_json::from_value(parsed_payload)
                .map_err(|error| TunnelProtocolError::new(error.to_string()))?;
            validate_stream_window(&message)?;
            Ok(StreamControlMessage::Window(message))
        }
        _ => Err(TunnelProtocolError::new(format!(
            "unsupported control message type '{message_type}'"
        ))),
    }
}

/// Parses one inbound PTY control frame from a websocket text payload.
pub fn parse_pty_control_message(payload: &str) -> Result<PtyControlMessage, TunnelProtocolError> {
    match parse_stream_control_message(payload)? {
        StreamControlMessage::Signal(message) => Ok(PtyControlMessage::Signal(message)),
        StreamControlMessage::Close(message) => Ok(PtyControlMessage::Close(message)),
        StreamControlMessage::Window(message) => Ok(PtyControlMessage::Window(message)),
        StreamControlMessage::OpenAgent(_)
        | StreamControlMessage::OpenProcesses(_)
        | StreamControlMessage::OpenFileUpload(_)
        | StreamControlMessage::OpenExec(_)
        | StreamControlMessage::OpenFileSearch(_) => Err(TunnelProtocolError::new(
            "expected PTY control message, got a different channel kind",
        )),
    }
}

/// Parses one inbound `processes` stream text payload.
pub fn parse_processes_stream_message(
    payload: &str,
) -> Result<ProcessesStreamMessage, TunnelProtocolError> {
    let parsed_payload: serde_json::Value = serde_json::from_str(payload).map_err(|error| {
        TunnelProtocolError::new(format!(
            "processes stream message must be valid json: {error}"
        ))
    })?;
    let message_type = parsed_payload
        .get("type")
        .and_then(serde_json::Value::as_str)
        .ok_or_else(|| TunnelProtocolError::new("processes stream message type is required"))?;

    match message_type {
        "processes.refresh" => {
            let message: ProcessesRefresh = serde_json::from_value(parsed_payload)
                .map_err(|error| TunnelProtocolError::new(error.to_string()))?;
            Ok(ProcessesStreamMessage::Refresh(message))
        }
        "processes.snapshot" => {
            let message: ProcessesSnapshot = serde_json::from_value(parsed_payload)
                .map_err(|error| TunnelProtocolError::new(error.to_string()))?;
            Ok(ProcessesStreamMessage::Snapshot(message))
        }
        _ => Err(TunnelProtocolError::new(format!(
            "unsupported processes stream message type '{message_type}'"
        ))),
    }
}

/// Parses one inbound `fileSearch` stream text payload.
pub fn parse_file_search_stream_message(
    payload: &str,
) -> Result<FileSearchStreamMessage, TunnelProtocolError> {
    let parsed_payload: serde_json::Value = serde_json::from_str(payload).map_err(|error| {
        TunnelProtocolError::new(format!(
            "fileSearch stream message must be valid json: {error}"
        ))
    })?;
    let message_type = parsed_payload
        .get("type")
        .and_then(serde_json::Value::as_str)
        .ok_or_else(|| TunnelProtocolError::new("fileSearch stream message type is required"))?;

    match message_type {
        "fileSearch.query" => {
            let message: FileSearchQuery = serde_json::from_value(parsed_payload)
                .map_err(|error| TunnelProtocolError::new(error.to_string()))?;
            validate_file_search_query(&message)?;
            Ok(FileSearchStreamMessage::Query(message))
        }
        "fileSearch.results" => {
            let message: FileSearchResults = serde_json::from_value(parsed_payload)
                .map_err(|error| TunnelProtocolError::new(error.to_string()))?;
            validate_file_search_results(&message)?;
            Ok(FileSearchStreamMessage::Results(message))
        }
        "fileSearch.error" => {
            let message: FileSearchError = serde_json::from_value(parsed_payload)
                .map_err(|error| TunnelProtocolError::new(error.to_string()))?;
            validate_file_search_error(&message)?;
            Ok(FileSearchStreamMessage::Error(message))
        }
        "fileSearch.select" => {
            let message: FileSearchSelect = serde_json::from_value(parsed_payload)
                .map_err(|error| TunnelProtocolError::new(error.to_string()))?;
            validate_file_search_select(&message)?;
            Ok(FileSearchStreamMessage::Select(message))
        }
        _ => Err(TunnelProtocolError::new(format!(
            "unsupported fileSearch stream message type '{message_type}'"
        ))),
    }
}

/// Parses one inbound `ports.*` control message.
pub fn parse_ports_control_message(
    payload: &str,
) -> Result<Option<PortsControlMessage>, TunnelProtocolError> {
    let parsed_payload: serde_json::Value = serde_json::from_str(payload).map_err(|error| {
        TunnelProtocolError::new(format!("ports control message must be valid json: {error}"))
    })?;
    let Some(message_type) = parsed_payload
        .get("type")
        .and_then(serde_json::Value::as_str)
    else {
        return Ok(None);
    };

    match message_type {
        "ports.target.authorize" => {
            let message: PortsTargetAuthorize = serde_json::from_value(parsed_payload)
                .map_err(|error| TunnelProtocolError::new(error.to_string()))?;
            validate_ports_target_authorize(&message)?;
            Ok(Some(PortsControlMessage::TargetAuthorize(message)))
        }
        _ => Ok(None),
    }
}

/// Parses one inbound `ports.http.*` transport message.
pub fn parse_ports_transport_message(
    payload: &str,
) -> Result<Option<PortsTransportMessage>, TunnelProtocolError> {
    let parsed_payload: serde_json::Value = serde_json::from_str(payload).map_err(|error| {
        TunnelProtocolError::new(format!(
            "ports transport message must be valid json: {error}"
        ))
    })?;
    let Some(message_type) = parsed_payload
        .get("type")
        .and_then(serde_json::Value::as_str)
    else {
        return Ok(None);
    };

    match message_type {
        "ports.tcp.open" => {
            let message: PortsTcpOpen = serde_json::from_value(parsed_payload)
                .map_err(|error| TunnelProtocolError::new(error.to_string()))?;
            validate_ports_tcp_open(&message)?;
            Ok(Some(PortsTransportMessage::TcpOpen(message)))
        }
        "ports.tcp.connected" => {
            let message: PortsTcpConnected = serde_json::from_value(parsed_payload)
                .map_err(|error| TunnelProtocolError::new(error.to_string()))?;
            validate_ports_tcp_connected(&message)?;
            Ok(Some(PortsTransportMessage::TcpConnected(message)))
        }
        "ports.tcp.close" => {
            let message: PortsTcpClose = serde_json::from_value(parsed_payload)
                .map_err(|error| TunnelProtocolError::new(error.to_string()))?;
            validate_ports_tcp_close(&message)?;
            Ok(Some(PortsTransportMessage::TcpClose(message)))
        }
        "ports.tcp.error" => {
            let message: PortsTcpError = serde_json::from_value(parsed_payload)
                .map_err(|error| TunnelProtocolError::new(error.to_string()))?;
            validate_ports_tcp_error(&message)?;
            Ok(Some(PortsTransportMessage::TcpError(message)))
        }
        "ports.http.open" => {
            let message: PortsHttpOpen = serde_json::from_value(parsed_payload)
                .map_err(|error| TunnelProtocolError::new(error.to_string()))?;
            validate_ports_http_open(&message)?;
            Ok(Some(PortsTransportMessage::HttpOpen(message)))
        }
        "ports.http.response.start" => {
            let message: PortsHttpResponseStart = serde_json::from_value(parsed_payload)
                .map_err(|error| TunnelProtocolError::new(error.to_string()))?;
            validate_ports_http_response_start(&message)?;
            Ok(Some(PortsTransportMessage::HttpResponseStart(message)))
        }
        "ports.http.body.chunk" => {
            let message: PortsHttpBodyChunk = serde_json::from_value(parsed_payload)
                .map_err(|error| TunnelProtocolError::new(error.to_string()))?;
            validate_ports_http_body_chunk(&message)?;
            Ok(Some(PortsTransportMessage::HttpBodyChunk(message)))
        }
        "ports.http.body.end" => {
            let message: PortsHttpBodyEnd = serde_json::from_value(parsed_payload)
                .map_err(|error| TunnelProtocolError::new(error.to_string()))?;
            validate_ports_http_body_end(&message)?;
            Ok(Some(PortsTransportMessage::HttpBodyEnd(message)))
        }
        "ports.stream.close" => {
            let message: PortsStreamClose = serde_json::from_value(parsed_payload)
                .map_err(|error| TunnelProtocolError::new(error.to_string()))?;
            validate_ports_stream_close(&message)?;
            Ok(Some(PortsTransportMessage::StreamClose(message)))
        }
        "ports.stream.error" => {
            let message: PortsStreamError = serde_json::from_value(parsed_payload)
                .map_err(|error| TunnelProtocolError::new(error.to_string()))?;
            validate_ports_stream_error(&message)?;
            Ok(Some(PortsTransportMessage::StreamError(message)))
        }
        _ => Ok(None),
    }
}

/// Parses one inbound bootstrap telemetry control message.
pub fn parse_bootstrap_telemetry_control_message(
    payload: &str,
) -> Result<Option<BootstrapTelemetryControlMessage>, TunnelProtocolError> {
    let parsed_payload: serde_json::Value = serde_json::from_str(payload).map_err(|error| {
        TunnelProtocolError::new(format!("control message must be valid json: {error}"))
    })?;
    let message_type = parsed_payload
        .get("type")
        .and_then(serde_json::Value::as_str)
        .ok_or_else(|| TunnelProtocolError::new("control message type is required"))?;

    match message_type {
        "telemetry.open.ok" => {
            let message: TelemetryOpenOk = serde_json::from_value(parsed_payload)
                .map_err(|error| TunnelProtocolError::new(error.to_string()))?;
            validate_telemetry_open_ok(&message)?;
            Ok(Some(BootstrapTelemetryControlMessage::OpenOk(message)))
        }
        "telemetry.open.error" => {
            let message: TelemetryOpenError = serde_json::from_value(parsed_payload)
                .map_err(|error| TunnelProtocolError::new(error.to_string()))?;
            validate_telemetry_open_error(&message)?;
            Ok(Some(BootstrapTelemetryControlMessage::OpenError(message)))
        }
        "telemetry.window" => {
            let message: TelemetryWindow = serde_json::from_value(parsed_payload)
                .map_err(|error| TunnelProtocolError::new(error.to_string()))?;
            validate_telemetry_window(&message)?;
            Ok(Some(BootstrapTelemetryControlMessage::Window(message)))
        }
        "telemetry.reset" => {
            let message: TelemetryReset = serde_json::from_value(parsed_payload)
                .map_err(|error| TunnelProtocolError::new(error.to_string()))?;
            validate_telemetry_reset(&message)?;
            Ok(Some(BootstrapTelemetryControlMessage::Reset(message)))
        }
        _ => Ok(None),
    }
}

/// Parses one inbound `signing.*` control message.
pub fn parse_signing_control_message(
    payload: &str,
) -> Result<Option<SigningControlMessage>, TunnelProtocolError> {
    let parsed_payload: serde_json::Value = serde_json::from_str(payload).map_err(|error| {
        TunnelProtocolError::new(format!(
            "signing control message must be valid json: {error}"
        ))
    })?;
    let Some(message_type) = parsed_payload
        .get("type")
        .and_then(serde_json::Value::as_str)
    else {
        return Ok(None);
    };

    match message_type {
        "signing.request" => {
            let message: SigningRequest = serde_json::from_value(parsed_payload)
                .map_err(|error| TunnelProtocolError::new(error.to_string()))?;
            validate_signing_request(&message)?;
            Ok(Some(SigningControlMessage::Request(message)))
        }
        "signing.result" => {
            let is_ok = parsed_payload
                .get("ok")
                .and_then(serde_json::Value::as_bool)
                .ok_or_else(|| TunnelProtocolError::new("signing.result ok flag is required"))?;

            if is_ok {
                let message: SigningSuccessResult = serde_json::from_value(parsed_payload)
                    .map_err(|error| TunnelProtocolError::new(error.to_string()))?;
                validate_signing_success_result(&message)?;
                Ok(Some(SigningControlMessage::ResultSuccess(message)))
            } else {
                let message: SigningFailureResult = serde_json::from_value(parsed_payload)
                    .map_err(|error| TunnelProtocolError::new(error.to_string()))?;
                validate_signing_failure_result(&message)?;
                Ok(Some(SigningControlMessage::ResultFailure(message)))
            }
        }
        _ => Ok(None),
    }
}

/// Parses one inbound `egress.token.*` control message.
pub fn parse_egress_token_control_message(
    payload: &str,
) -> Result<Option<EgressTokenControlMessage>, TunnelProtocolError> {
    let parsed_payload: serde_json::Value = serde_json::from_str(payload).map_err(|error| {
        TunnelProtocolError::new(format!(
            "egress token control message must be valid json: {error}"
        ))
    })?;
    let Some(message_type) = parsed_payload
        .get("type")
        .and_then(serde_json::Value::as_str)
    else {
        return Ok(None);
    };

    match message_type {
        "egress.token.request" => {
            let message: EgressTokenRequest = serde_json::from_value(parsed_payload)
                .map_err(|error| TunnelProtocolError::new(error.to_string()))?;
            validate_egress_token_request(&message)?;
            Ok(Some(EgressTokenControlMessage::Request(message)))
        }
        "egress.token.response" => {
            let message: EgressTokenResponse = serde_json::from_value(parsed_payload)
                .map_err(|error| TunnelProtocolError::new(error.to_string()))?;
            validate_egress_token_response(&message)?;
            Ok(Some(EgressTokenControlMessage::Response(message)))
        }
        "egress.token.error" => {
            let message: EgressTokenError = serde_json::from_value(parsed_payload)
                .map_err(|error| TunnelProtocolError::new(error.to_string()))?;
            validate_egress_token_error(&message)?;
            Ok(Some(EgressTokenControlMessage::Error(message)))
        }
        _ => Ok(None),
    }
}

/// Parses one inbound `pty.session.*` control message.
pub fn parse_pty_session_control_message(
    payload: &str,
) -> Result<Option<PtySessionControlMessage>, TunnelProtocolError> {
    let parsed_payload: serde_json::Value = serde_json::from_str(payload).map_err(|error| {
        TunnelProtocolError::new(format!(
            "pty session control message must be valid json: {error}"
        ))
    })?;
    let Some(message_type) = parsed_payload
        .get("type")
        .and_then(serde_json::Value::as_str)
    else {
        return Ok(None);
    };

    match message_type {
        "pty.session.open" => {
            let message: PtySessionOpen = serde_json::from_value(parsed_payload)
                .map_err(|error| TunnelProtocolError::new(error.to_string()))?;
            validate_pty_session_open(&message)?;
            Ok(Some(PtySessionControlMessage::Open(message)))
        }
        "pty.session.opened" => {
            let message: PtySessionOpened = serde_json::from_value(parsed_payload)
                .map_err(|error| TunnelProtocolError::new(error.to_string()))?;
            validate_pty_session_opened(&message)?;
            Ok(Some(PtySessionControlMessage::Opened(message)))
        }
        "pty.session.error" => {
            let message: PtySessionError = serde_json::from_value(parsed_payload)
                .map_err(|error| TunnelProtocolError::new(error.to_string()))?;
            validate_pty_session_error(&message)?;
            Ok(Some(PtySessionControlMessage::Error(message)))
        }
        _ => Ok(None),
    }
}
