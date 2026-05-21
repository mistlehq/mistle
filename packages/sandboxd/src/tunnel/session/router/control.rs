use super::*;

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
