//! Handling for inbound tunnel binary data frames.
//!
//! Binary frames carry stream payload bytes. This module applies flow-control
//! accounting and forwards data to the correct runtime-side stream.

use super::*;

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
