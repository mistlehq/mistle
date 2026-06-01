//! Internal event handling for the tunnel session router.
//!
//! Runtime tasks and stream handlers send these events back to the router so one
//! loop can serialize writes and mutate shared session state.

use super::*;
use tracing::{field, warn};

pub(in crate::tunnel::session) async fn handle_tunnel_session_event(
    event: TunnelSessionEvent,
    tunnel_writer_sender: &mpsc::UnboundedSender<TunnelWriterMessage>,
    event_sender: &mpsc::UnboundedSender<TunnelSessionEvent>,
    context: &TunnelSessionLoopContext<'_>,
    session_state: &mut TunnelSessionMutableState,
) -> Result<TunnelSessionControlFlow, TunnelSessionError> {
    match event {
        TunnelSessionEvent::BootstrapClosed {
            is_gateway_service_restart,
            reason,
        } => {
            let reason_text = reason.unwrap_or_else(|| "bootstrap tunnel closed".to_string());
            warn!(
                event = "bootstrap_tunnel.router_observed_closed",
                is_gateway_service_restart,
                reason = %reason_text,
                pending_agent_open_count = session_state.pending_agent_opens.len(),
                active_agent_stream_count = session_state.agent_streams.len(),
                pending_exec_open_count = session_state.pending_exec_opens.len(),
                active_port_access_http_stream_count = session_state.port_access_http_streams.len(),
                active_port_access_tcp_stream_count = session_state.port_access_tcp_streams.len(),
                active_file_search_stream_count = session_state.file_search_streams.len(),
                active_file_upload_count = session_state.file_uploads.len(),
                operation_stream_requested = session_state.operation_stream_requested,
                operation_stream_close_requested = session_state.operation_stream_close_requested,
                pending_operation_record_count = session_state.pending_operation_records.len(),
                agent_endpoint_url = field::display(
                    session_state.agent_endpoint_url.as_deref().unwrap_or("")
                ),
            );
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
            if is_gateway_service_restart {
                Ok(TunnelSessionControlFlow::RestartRequired)
            } else {
                Ok(TunnelSessionControlFlow::ShutdownRequested)
            }
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
