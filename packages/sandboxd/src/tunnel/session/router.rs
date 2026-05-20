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

use crate::protocol::startup::StartupInput;
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
    TunnelWebSocket, TunnelWriterMessage, send_telemetry_frames, write_tunnel_pong,
    write_tunnel_text,
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
                    let written_bytes = match &message {
                        Message::Text(payload) => Some(payload.len()),
                        Message::Binary(payload) => Some(payload.len()),
                        _ => None,
                    };
                    if let Err(error) = writer.send(message).await {
                        let _ = event_sender.send(TunnelSessionEvent::AgentClosed {
                            stream_id,
                            reason: Some(error.to_string()),
                        });
                        return;
                    }
                    if let Some(bytes) = written_bytes {
                        let _ = event_sender.send(TunnelSessionEvent::AgentWriteCompleted {
                            stream_id,
                            bytes,
                        });
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

pub(in crate::tunnel::session) fn spawn_port_access_transport_event_sender(
    event_sender: &mpsc::UnboundedSender<TunnelSessionEvent>,
) -> mpsc::UnboundedSender<PortAccessTransportEvent> {
    let (transport_event_sender, mut transport_event_receiver) = mpsc::unbounded_channel();
    let event_sender = event_sender.clone();
    tokio::spawn(async move {
        while let Some(event) = transport_event_receiver.recv().await {
            if event_sender
                .send(TunnelSessionEvent::PortAccessTransport(event))
                .is_err()
            {
                return;
            }
        }
    });
    transport_event_sender
}

fn spawn_agent_dial_task(
    stream_id: u32,
    runtime_endpoint_url: String,
    event_sender: mpsc::UnboundedSender<TunnelSessionEvent>,
) -> TokioJoinHandle<()> {
    tokio::spawn(async move {
        let result = match connect_async(&runtime_endpoint_url).await {
            Ok((runtime_socket, _)) => Ok(runtime_socket),
            Err(error) => Err(error.to_string()),
        };
        let _ = event_sender.send(TunnelSessionEvent::AgentDialed {
            stream_id,
            result: Box::new(result),
        });
    })
}

pub(in crate::tunnel::session) async fn handle_tunnel_session_event(
    event: TunnelSessionEvent,
    tunnel_writer_sender: &mpsc::UnboundedSender<TunnelWriterMessage>,
    event_sender: &mpsc::UnboundedSender<TunnelSessionEvent>,
    context: &TunnelSessionLoopContext<'_>,
    session_state: &mut TunnelSessionMutableState,
) -> Result<TunnelSessionControlFlow, TunnelSessionError> {
    match event {
        TunnelSessionEvent::BootstrapClosed { reason } => {
            let reason_text = reason.unwrap_or_else(|| "bootstrap tunnel closed".to_string());
            close_port_access_tcp_streams(session_state);
            publish_bootstrap_closed_agent_stream_summaries(
                tunnel_writer_sender,
                session_state,
                context.clock,
                &reason_text,
            );
            update_tunnel_supervision_details(
                context.supervisor_handle,
                context.gateway_ws_url,
                Some("bootstrap_closed"),
                None,
                None,
            );
            context
                .supervisor_handle
                .mark_component_restarting(SupervisedComponent::TunnelSession, reason_text.clone());
            context.supervisor_handle.emit_component_healthcheck_failed(
                SupervisedComponent::TunnelSession,
                "bootstrap_closed",
                reason_text,
                "bootstrap_connection",
                &[],
            );
            Ok(TunnelSessionControlFlow::RestartRequired)
        }
        TunnelSessionEvent::Wake => {
            if let Err(error) = poll_process_streams(
                tunnel_writer_sender,
                &mut session_state.process_streams,
                context.clock,
            ) {
                reset_process_streams(
                    tunnel_writer_sender,
                    &mut session_state.process_streams,
                    error.to_string(),
                )?;
            }
            Ok(TunnelSessionControlFlow::Continue)
        }
        TunnelSessionEvent::FileSearch(event) => {
            handle_file_search_worker_event(
                tunnel_writer_sender,
                event,
                context.clock,
                session_state,
            )?;
            Ok(TunnelSessionControlFlow::Continue)
        }
        TunnelSessionEvent::AgentDialed { stream_id, result } => {
            let result = *result;
            if session_state
                .pending_agent_opens
                .remove(&stream_id)
                .is_none()
            {
                if let Ok(runtime_socket) = result {
                    drop(runtime_socket);
                }
                return Ok(TunnelSessionControlFlow::Continue);
            }

            match result {
                Ok(runtime_socket) => {
                    let sender =
                        spawn_agent_stream_task(stream_id, runtime_socket, event_sender.clone());
                    session_state.agent_streams.insert(
                        stream_id,
                        create_agent_stream(sender, context.clock.now_ms()),
                    );
                    continue_with(write_tunnel_text(
                        tunnel_writer_sender,
                        stream_open_ok(stream_id),
                    ))
                }
                Err(error) => continue_with(write_tunnel_text(
                    tunnel_writer_sender,
                    stream_open_error(
                        stream_id,
                        CONNECT_ERROR_CODE_AGENT_ENDPOINT_DIAL_FAILED,
                        format!("failed to connect agent endpoint: {error}"),
                    ),
                )),
            }
        }
        TunnelSessionEvent::BootstrapMessage(message) => match message {
            Message::Text(payload) => {
                match session_state
                    .telemetry_relay
                    .handle_control_message(&payload)
                {
                    Ok(Some(frames)) => {
                        send_telemetry_frames(tunnel_writer_sender, frames)?;
                        return Ok(TunnelSessionControlFlow::Continue);
                    }
                    Ok(None) => {}
                    Err(error) => {
                        report_dropped_bootstrap_text_message(
                            tunnel_writer_sender,
                            &mut session_state.telemetry_relay,
                            context.clock,
                            format!("telemetry control rejected: {error}"),
                        );
                        return Ok(TunnelSessionControlFlow::Continue);
                    }
                }

                match parse_ports_control_message(&payload) {
                    Ok(Some(crate::tunnel::protocol::PortsControlMessage::TargetAuthorize(
                        message,
                    ))) => {
                        handle_ports_control_message(tunnel_writer_sender, message, context.clock)
                            .await?;
                        return Ok(TunnelSessionControlFlow::Continue);
                    }
                    Ok(None) => {}
                    Err(error) => {
                        report_dropped_bootstrap_text_message(
                            tunnel_writer_sender,
                            &mut session_state.telemetry_relay,
                            context.clock,
                            error.to_string(),
                        );
                        return Ok(TunnelSessionControlFlow::Continue);
                    }
                }

                match parse_ports_transport_message(&payload) {
                    Ok(Some(message)) => {
                        if let Err(error) =
                            handle_ports_transport_message(message, event_sender, session_state)
                        {
                            report_dropped_bootstrap_text_message(
                                tunnel_writer_sender,
                                &mut session_state.telemetry_relay,
                                context.clock,
                                error.to_string(),
                            );
                        }
                        return Ok(TunnelSessionControlFlow::Continue);
                    }
                    Ok(None) => {}
                    Err(error) => {
                        report_dropped_bootstrap_text_message(
                            tunnel_writer_sender,
                            &mut session_state.telemetry_relay,
                            context.clock,
                            error.to_string(),
                        );
                        return Ok(TunnelSessionControlFlow::Continue);
                    }
                }

                match parse_signing_control_message(&payload) {
                    Ok(Some(message)) => {
                        handle_signing_control_message(session_state, message);
                        return Ok(TunnelSessionControlFlow::Continue);
                    }
                    Ok(None) => {}
                    Err(error) => {
                        report_dropped_bootstrap_text_message(
                            tunnel_writer_sender,
                            &mut session_state.telemetry_relay,
                            context.clock,
                            error.to_string(),
                        );
                        return Ok(TunnelSessionControlFlow::Continue);
                    }
                }

                match parse_egress_token_control_message(&payload) {
                    Ok(Some(message)) => {
                        handle_egress_token_control_message(
                            session_state,
                            tunnel_writer_sender,
                            context.clock,
                            context.sandbox_instance_id,
                            message,
                        );
                        return Ok(TunnelSessionControlFlow::Continue);
                    }
                    Ok(None) => {}
                    Err(error) => {
                        report_dropped_bootstrap_text_message(
                            tunnel_writer_sender,
                            &mut session_state.telemetry_relay,
                            context.clock,
                            error.to_string(),
                        );
                        return Ok(TunnelSessionControlFlow::Continue);
                    }
                }

                if handle_operation_control_message(&payload, tunnel_writer_sender, session_state) {
                    return Ok(TunnelSessionControlFlow::Continue);
                }

                match parse_pty_session_control_message(&payload) {
                    Ok(Some(message)) => {
                        handle_pty_session_control_message(
                            message,
                            tunnel_writer_sender,
                            context.cgroup_root,
                            &session_state.runtime_env,
                            context.sandbox_instance_id,
                        )?;
                        return Ok(TunnelSessionControlFlow::Continue);
                    }
                    Ok(None) => {}
                    Err(error) => {
                        report_dropped_bootstrap_text_message(
                            tunnel_writer_sender,
                            &mut session_state.telemetry_relay,
                            context.clock,
                            error.to_string(),
                        );
                        return Ok(TunnelSessionControlFlow::Continue);
                    }
                }

                let control_message = match parse_stream_control_message(&payload) {
                    Ok(message) => message,
                    Err(error) => {
                        report_dropped_bootstrap_text_message(
                            tunnel_writer_sender,
                            &mut session_state.telemetry_relay,
                            context.clock,
                            error.to_string(),
                        );
                        return Ok(TunnelSessionControlFlow::Continue);
                    }
                };
                continue_with(
                    handle_tunnel_control_message(
                        tunnel_writer_sender,
                        event_sender,
                        control_message,
                        context,
                        session_state,
                    )
                    .await,
                )
            }
            Message::Binary(payload) => {
                let frame = match decode_stream_data_frame(payload.as_ref()) {
                    Ok(frame) => frame,
                    Err(error) => {
                        report_dropped_bootstrap_binary_frame(
                            tunnel_writer_sender,
                            &mut session_state.telemetry_relay,
                            context.clock,
                            error.to_string(),
                        );
                        return Ok(TunnelSessionControlFlow::Continue);
                    }
                };
                continue_with(handle_tunnel_binary_frame(
                    tunnel_writer_sender,
                    frame,
                    session_state,
                    context.clock,
                ))
            }
            Message::Ping(payload) => {
                continue_with(write_tunnel_pong(tunnel_writer_sender, payload.to_vec()))
            }
            Message::Pong(_) => Ok(TunnelSessionControlFlow::Continue),
            Message::Close(_) => Ok(TunnelSessionControlFlow::RestartRequired),
            _ => Ok(TunnelSessionControlFlow::Continue),
        },
        TunnelSessionEvent::AgentMessage { stream_id, message } => {
            continue_with(handle_agent_runtime_message(
                tunnel_writer_sender,
                session_state,
                context.clock,
                stream_id,
                message,
            ))
        }
        TunnelSessionEvent::AgentWriteCompleted { stream_id, bytes } => {
            if !session_state.agent_streams.contains_key(&stream_id) {
                return Ok(TunnelSessionControlFlow::Continue);
            }

            continue_with(write_tunnel_text(
                tunnel_writer_sender,
                stream_window(stream_id, bytes),
            ))
        }
        TunnelSessionEvent::PortAccessTransport(event) => {
            handle_port_access_transport_event(tunnel_writer_sender, event, session_state)?;
            Ok(TunnelSessionControlFlow::Continue)
        }
        TunnelSessionEvent::AgentClosed { stream_id, reason } => {
            if remove_agent_stream_and_publish_summary(
                tunnel_writer_sender,
                session_state,
                context.clock,
                stream_id,
                AgentStreamTermination {
                    outcome: AGENT_STREAM_OUTCOME_RESET,
                    close_source: AGENT_STREAM_CLOSE_SOURCE_RUNTIME,
                    reset_code: Some(STREAM_RESET_CODE_TARGET_CLOSED),
                    reason: Some(
                        reason
                            .clone()
                            .unwrap_or_else(|| "agent runtime websocket closed".to_string()),
                    ),
                },
            )
            .is_some()
            {
                write_tunnel_text(
                    tunnel_writer_sender,
                    stream_reset(
                        stream_id,
                        STREAM_RESET_CODE_TARGET_CLOSED,
                        reason.unwrap_or_else(|| "agent runtime websocket closed".to_string()),
                    ),
                )?;
            }
            Ok(TunnelSessionControlFlow::Continue)
        }
        TunnelSessionEvent::ExecCompleted { stream_id, result } => {
            if session_state
                .pending_exec_opens
                .remove(&stream_id)
                .is_none()
            {
                return Ok(TunnelSessionControlFlow::Continue);
            }

            match *result {
                Ok(exec_result) => {
                    write_tunnel_text(
                        tunnel_writer_sender,
                        exec_result_event(
                            stream_id,
                            exec_result.exit_code,
                            &exec_result.stdout,
                            &exec_result.stderr,
                            exec_result.truncated,
                        ),
                    )?;
                    continue_with(write_tunnel_text(
                        tunnel_writer_sender,
                        stream_complete(stream_id),
                    ))
                }
                Err(error) => continue_with(write_tunnel_text(
                    tunnel_writer_sender,
                    stream_reset(stream_id, STREAM_RESET_CODE_EXEC_COMMAND_FAILED, error),
                )),
            }
        }
    }
}

pub(in crate::tunnel::session) fn handle_tunnel_session_request(
    request: TunnelSessionRequest,
    tunnel_writer_sender: &mpsc::UnboundedSender<TunnelWriterMessage>,
    runtime: &TunnelSessionRuntime,
    session_state: &mut TunnelSessionMutableState,
) -> Result<TunnelSessionControlFlow, TunnelSessionError> {
    match request {
        TunnelSessionRequest::SetAgentEndpoint {
            agent_endpoint_url,
            response_sender,
        } => {
            set_runtime_agent_endpoint_url(runtime, agent_endpoint_url.clone());
            session_state.agent_endpoint_url = agent_endpoint_url;
            let _ = response_sender.send(Ok(()));
            Ok(TunnelSessionControlFlow::Continue)
        }
        TunnelSessionRequest::SetRuntimeEnvironment {
            runtime_env,
            response_sender,
        } => {
            set_runtime_environment(runtime, runtime_env.clone());
            session_state.runtime_env = runtime_env;
            let _ = response_sender.send(Ok(()));
            Ok(TunnelSessionControlFlow::Continue)
        }
        TunnelSessionRequest::Signing {
            request,
            response_sender,
        } => continue_with(handle_signing_session_request(
            tunnel_writer_sender,
            session_state,
            request,
            response_sender,
        )),
        TunnelSessionRequest::EgressToken {
            request_id,
            response_sender,
        } => continue_with(handle_egress_token_session_request(
            tunnel_writer_sender,
            session_state,
            runtime.clock.as_ref(),
            runtime.sandbox_instance_id.as_str(),
            request_id,
            response_sender,
        )),
        TunnelSessionRequest::OperationRecord { line } => {
            enqueue_operation_record(session_state, line);
            flush_pending_operation_records(tunnel_writer_sender, session_state);
            Ok(TunnelSessionControlFlow::Continue)
        }
        TunnelSessionRequest::OperationClose { response_sender } => {
            close_operation_stream(tunnel_writer_sender, session_state, response_sender);
            Ok(TunnelSessionControlFlow::Continue)
        }
    }
}

pub(in crate::tunnel::session) fn startup_operation_kind(
    startup_input: &StartupInput,
) -> &'static str {
    startup_input.operation_kind.as_str()
}

pub(in crate::tunnel::session) fn derive_startup_operation_id(
    tunnel_gateway_ws_url: &str,
) -> Option<String> {
    let Ok(url) = Url::parse(tunnel_gateway_ws_url) else {
        return None;
    };
    url.query_pairs().find_map(|(name, value)| {
        if name == "operation_id" && !value.is_empty() {
            Some(value.into_owned())
        } else {
            None
        }
    })
}

pub(in crate::tunnel::session) async fn handle_tunnel_control_message(
    tunnel_writer_sender: &mpsc::UnboundedSender<TunnelWriterMessage>,
    event_sender: &mpsc::UnboundedSender<TunnelSessionEvent>,
    control_message: StreamControlMessage,
    context: &TunnelSessionLoopContext<'_>,
    session_state: &mut TunnelSessionMutableState,
) -> Result<(), TunnelSessionError> {
    match control_message {
        StreamControlMessage::OpenAgent(message) => {
            if reject_duplicate_tunnel_stream_open(
                tunnel_writer_sender,
                session_state,
                message.stream_id,
            )? {
                return Ok(());
            }
            let Some(runtime_endpoint_url) = session_state.agent_endpoint_url.as_deref() else {
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
            session_state.pending_agent_opens.insert(
                message.stream_id,
                PendingAgentOpenState {
                    task: spawn_agent_dial_task(
                        message.stream_id,
                        runtime_endpoint_url.to_string(),
                        event_sender.clone(),
                    ),
                },
            );
        }
        StreamControlMessage::OpenProcesses(message) => {
            if reject_duplicate_tunnel_stream_open(
                tunnel_writer_sender,
                session_state,
                message.stream_id,
            )? {
                return Ok(());
            }
            open_process_stream(
                tunnel_writer_sender,
                &mut session_state.process_streams,
                message.stream_id,
                context.clock,
            )?;
        }
        StreamControlMessage::OpenFileUpload(message) => {
            if reject_duplicate_tunnel_stream_open(
                tunnel_writer_sender,
                session_state,
                message.stream_id,
            )? {
                return Ok(());
            }
            let upload_state =
                create_file_upload_state(&message, context.attachment_root, context.clock)
                    .map_err(TunnelSessionError::FileUpload)?;
            session_state
                .file_uploads
                .insert(message.stream_id, upload_state);
            write_tunnel_text(tunnel_writer_sender, stream_open_ok(message.stream_id))?;
        }
        StreamControlMessage::OpenExec(message) => {
            if reject_duplicate_tunnel_stream_open(
                tunnel_writer_sender,
                session_state,
                message.stream_id,
            )? {
                return Ok(());
            }
            let pending_exec_open = PendingExecOpenState::new();
            session_state
                .pending_exec_opens
                .insert(message.stream_id, pending_exec_open.clone());
            spawn_exec_task(
                message.clone(),
                session_state.runtime_env.clone(),
                &pending_exec_open,
                event_sender.clone(),
            );
            write_tunnel_text(tunnel_writer_sender, stream_open_ok(message.stream_id))?;
        }
        StreamControlMessage::OpenFileSearch(message) => {
            if reject_duplicate_tunnel_stream_open(
                tunnel_writer_sender,
                session_state,
                message.stream_id,
            )? {
                return Ok(());
            }
            let event_sender = event_sender.clone();
            let stream_id = message.stream_id;
            let open_started_at = Instant::now();
            let worker =
                match spawn_file_search_worker(stream_id, &message.channel.cwd, move |event| {
                    let _ = event_sender.send(TunnelSessionEvent::FileSearch(event));
                }) {
                    Ok(worker) => worker,
                    Err(error) => {
                        publish_tunnel_telemetry_log(
                            tunnel_writer_sender,
                            &mut session_state.telemetry_relay,
                            context.clock,
                            SandboxTelemetryLogLevel::Warn,
                            "file_search_stream_open_failed",
                            &[
                                ("streamId", Value::from(u64::from(stream_id))),
                                (
                                    "channelKind",
                                    Value::String(FILE_SEARCH_STREAM_CHANNEL_KIND.to_string()),
                                ),
                                (
                                    "latencyMs",
                                    Value::from(open_started_at.elapsed().as_millis() as u64),
                                ),
                                ("error", Value::String(error.clone())),
                            ],
                        );
                        write_tunnel_text(
                            tunnel_writer_sender,
                            stream_open_error(stream_id, "file_search_open_failed", error),
                        )?;
                        return Ok(());
                    }
                };
            session_state.file_search_streams.insert(
                stream_id,
                FileSearchStreamState::new(worker, context.clock.now_ms()),
            );
            publish_tunnel_telemetry_log(
                tunnel_writer_sender,
                &mut session_state.telemetry_relay,
                context.clock,
                SandboxTelemetryLogLevel::Info,
                FILE_SEARCH_EVENT_STREAM_OPENED,
                &[
                    ("streamId", Value::from(u64::from(stream_id))),
                    (
                        "channelKind",
                        Value::String(FILE_SEARCH_STREAM_CHANNEL_KIND.to_string()),
                    ),
                    (
                        "latencyMs",
                        Value::from(open_started_at.elapsed().as_millis() as u64),
                    ),
                ],
            );
            write_tunnel_text(tunnel_writer_sender, stream_open_ok(stream_id))?;
        }
        StreamControlMessage::Signal(message) => {
            write_tunnel_text(
                tunnel_writer_sender,
                stream_reset(
                    message.stream_id,
                    STREAM_RESET_CODE_INVALID_STREAM_SIGNAL,
                    "stream.signal is not supported on bootstrap tunnel streams",
                ),
            )?;
        }
        StreamControlMessage::Close(message) => {
            if let Some(pending_agent_open) =
                session_state.pending_agent_opens.remove(&message.stream_id)
            {
                pending_agent_open.task.abort();
                return Ok(());
            }
            if let Some(agent_stream) = remove_agent_stream_and_publish_summary(
                tunnel_writer_sender,
                session_state,
                context.clock,
                message.stream_id,
                AgentStreamTermination {
                    outcome: AGENT_STREAM_OUTCOME_CLOSED,
                    close_source: AGENT_STREAM_CLOSE_SOURCE_GATEWAY,
                    reset_code: None,
                    reason: None,
                },
            ) {
                let _ = agent_stream.sender.send(Message::Close(None));
                return Ok(());
            }
            if close_process_stream(&mut session_state.process_streams, message.stream_id) {
                return Ok(());
            }
            if session_state
                .file_search_streams
                .contains_key(&message.stream_id)
            {
                close_file_search_stream(
                    tunnel_writer_sender,
                    session_state,
                    context.clock,
                    message.stream_id,
                    FileSearchStreamCloseTelemetry {
                        outcome: FILE_SEARCH_OUTCOME_CLOSED,
                        close_source: FILE_SEARCH_CLOSE_SOURCE_GATEWAY,
                        reason: None,
                    },
                );
                return Ok(());
            }
            if let Some(pending_exec_open) =
                session_state.pending_exec_opens.remove(&message.stream_id)
            {
                cancel_pending_exec_open(pending_exec_open);
                return Ok(());
            }
            if let Some(upload_state) = session_state.file_uploads.remove(&message.stream_id) {
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
            if add_agent_stream_window_credit(
                session_state,
                message.stream_id,
                message.bytes,
                context.clock.now_ms(),
            )? {
                return Ok(());
            }
            if add_process_stream_window(
                &mut session_state.process_streams,
                message.stream_id,
                message.bytes,
            )? {
                return Ok(());
            }
            if let Some(stream_state) = session_state
                .file_search_streams
                .get_mut(&message.stream_id)
            {
                stream_state
                    .send_window
                    .add(message.bytes)
                    .map_err(|error| TunnelSessionError::ParseControl(error.to_string()))?;
                return Ok(());
            }
            if let Some(stream_state) = session_state
                .port_access_tcp_streams
                .get(&message.stream_id)
            {
                stream_state
                    .sender
                    .send(PortAccessTcpCommand::Window {
                        bytes: message.bytes,
                    })
                    .map_err(|error| TunnelSessionError::PortAccess(error.to_string()))?;
                return Ok(());
            }
            if session_state
                .pending_agent_opens
                .contains_key(&message.stream_id)
            {
                return Ok(());
            }
            if session_state
                .pending_exec_opens
                .contains_key(&message.stream_id)
            {
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

fn reject_duplicate_tunnel_stream_open(
    tunnel_writer_sender: &mpsc::UnboundedSender<TunnelWriterMessage>,
    session_state: &TunnelSessionMutableState,
    stream_id: u32,
) -> Result<bool, TunnelSessionError> {
    if !port_access_stream_is_active(session_state, stream_id) {
        return Ok(false);
    }

    write_tunnel_text(
        tunnel_writer_sender,
        stream_open_error(
            stream_id,
            CONNECT_ERROR_CODE_INVALID_CONNECT_REQUEST,
            format!("stream.open streamId {stream_id} already exists"),
        ),
    )?;
    Ok(true)
}

pub(in crate::tunnel::session) fn tunnel_stream_is_active(
    session_state: &TunnelSessionMutableState,
    stream_id: u32,
) -> bool {
    session_state.agent_streams.contains_key(&stream_id)
        || session_state.pending_agent_opens.contains_key(&stream_id)
        || session_state.pending_exec_opens.contains_key(&stream_id)
        || session_state.process_streams.is_active(stream_id)
        || session_state.file_search_streams.contains_key(&stream_id)
        || session_state.file_uploads.contains_key(&stream_id)
}

pub(in crate::tunnel::session) fn handle_tunnel_binary_frame(
    tunnel_writer_sender: &mpsc::UnboundedSender<TunnelWriterMessage>,
    frame: crate::tunnel::protocol::StreamDataFrame,
    session_state: &mut TunnelSessionMutableState,
    clock: &dyn Clock,
) -> Result<(), TunnelSessionError> {
    if session_state.agent_streams.contains_key(&frame.stream_id) {
        forward_gateway_frame_to_agent(tunnel_writer_sender, session_state, clock, frame)?;
        return Ok(());
    }

    if session_state.process_streams.is_active(frame.stream_id) {
        handle_process_stream_frame(
            tunnel_writer_sender,
            &mut session_state.process_streams,
            frame,
            clock,
        )?;
        return Ok(());
    }

    if session_state
        .file_search_streams
        .contains_key(&frame.stream_id)
    {
        if frame.payload_kind != PAYLOAD_KIND_WEBSOCKET_TEXT {
            write_tunnel_text(
                tunnel_writer_sender,
                stream_reset(
                    frame.stream_id,
                    STREAM_RESET_CODE_INVALID_STREAM_DATA,
                    "file search stream only accepts websocket text payloads",
                ),
            )?;
            close_file_search_stream(
                tunnel_writer_sender,
                session_state,
                clock,
                frame.stream_id,
                FileSearchStreamCloseTelemetry {
                    outcome: FILE_SEARCH_OUTCOME_RESET,
                    close_source: FILE_SEARCH_CLOSE_SOURCE_SANDBOXD,
                    reason: Some(
                        "file search stream only accepts websocket text payloads".to_string(),
                    ),
                },
            );
            return Ok(());
        }

        let payload = String::from_utf8(frame.payload)
            .map_err(|error| TunnelSessionError::ParseDataFrame(error.to_string()))?;
        match parse_file_search_stream_message(&payload) {
            Ok(crate::tunnel::protocol::FileSearchStreamMessage::Query(message)) => {
                write_tunnel_text(
                    tunnel_writer_sender,
                    stream_window(frame.stream_id, payload.len()),
                )?;
                send_file_search_command(
                    tunnel_writer_sender,
                    session_state,
                    clock,
                    frame.stream_id,
                    FileSearchWorkerCommand::Query(message),
                )?;
            }
            Ok(crate::tunnel::protocol::FileSearchStreamMessage::Select(message)) => {
                write_tunnel_text(
                    tunnel_writer_sender,
                    stream_window(frame.stream_id, payload.len()),
                )?;
                send_file_search_command(
                    tunnel_writer_sender,
                    session_state,
                    clock,
                    frame.stream_id,
                    FileSearchWorkerCommand::Select(message),
                )?;
            }
            Ok(crate::tunnel::protocol::FileSearchStreamMessage::Results(_))
            | Ok(crate::tunnel::protocol::FileSearchStreamMessage::Error(_)) => {
                write_tunnel_text(
                    tunnel_writer_sender,
                    stream_reset(
                        frame.stream_id,
                        STREAM_RESET_CODE_INVALID_STREAM_DATA,
                        "file search stream does not accept result payloads from the gateway",
                    ),
                )?;
                close_file_search_stream(
                    tunnel_writer_sender,
                    session_state,
                    clock,
                    frame.stream_id,
                    FileSearchStreamCloseTelemetry {
                        outcome: FILE_SEARCH_OUTCOME_RESET,
                        close_source: FILE_SEARCH_CLOSE_SOURCE_SANDBOXD,
                        reason: Some(
                            "file search stream does not accept result payloads from the gateway"
                                .to_string(),
                        ),
                    },
                );
            }
            Err(error) => {
                let reason = error.to_string();
                write_tunnel_text(
                    tunnel_writer_sender,
                    stream_reset(
                        frame.stream_id,
                        STREAM_RESET_CODE_INVALID_STREAM_DATA,
                        reason.clone(),
                    ),
                )?;
                close_file_search_stream(
                    tunnel_writer_sender,
                    session_state,
                    clock,
                    frame.stream_id,
                    FileSearchStreamCloseTelemetry {
                        outcome: FILE_SEARCH_OUTCOME_RESET,
                        close_source: FILE_SEARCH_CLOSE_SOURCE_SANDBOXD,
                        reason: Some(reason),
                    },
                );
            }
        }
        return Ok(());
    }

    if session_state
        .port_access_tcp_streams
        .contains_key(&frame.stream_id)
    {
        handle_port_access_tcp_data_frame(tunnel_writer_sender, frame, session_state)?;
        return Ok(());
    }

    if session_state.file_uploads.contains_key(&frame.stream_id) {
        if frame.payload_kind != PAYLOAD_KIND_RAW_BYTES {
            if let Some(upload_state) = session_state.file_uploads.remove(&frame.stream_id) {
                let _ = fs::remove_file(&upload_state.temp_path);
            }
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

        let Some(upload_state) = session_state.file_uploads.get_mut(&frame.stream_id) else {
            return Ok(());
        };
        upload_state.received_bytes = upload_state
            .received_bytes
            .saturating_add(frame.payload.len());
        if upload_state.received_bytes > upload_state.size_bytes {
            if let Some(upload_state) = session_state.file_uploads.remove(&frame.stream_id) {
                let _ = fs::remove_file(&upload_state.temp_path);
            }
            write_tunnel_text(
                tunnel_writer_sender,
                stream_reset(
                    frame.stream_id,
                    FILE_UPLOAD_RESET_CODE_BYTE_COUNT_EXCEEDED,
                    "received more bytes than declared by the upload metadata",
                ),
            )?;
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
