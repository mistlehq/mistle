//! Direct PTY transport handling for the live tunnel session.

use std::collections::BTreeMap;
use std::path::{Path, PathBuf};
use std::thread;

use futures_util::{SinkExt, StreamExt};
use tokio::runtime::Builder;
use tokio::sync::mpsc;
use tokio_tungstenite::connect_async;
use tokio_tungstenite::tungstenite::Message;

use crate::pty::{
    DEFAULT_PTY_TERMINATE_POLL_INTERVAL, DEFAULT_PTY_TERMINATE_TIMEOUT_MS, PtyEvent,
    PtySpawnRequest, start_scoped_pty_session,
};
use crate::time::Duration;
use crate::tunnel::protocol::{
    PtyControlMessage, PtySessionControlMessage, PtySessionLaunchMode, PtySessionOpen,
    STREAM_RESET_CODE_INVALID_STREAM_SIGNAL, STREAM_RESET_CODE_TARGET_CLOSED,
    parse_pty_control_message, pty_exit_event, pty_session_error, pty_session_opened, stream_reset,
};
use crate::tunnel::session::bootstrap::{TunnelWriterMessage, write_tunnel_text};
use crate::tunnel::session::{DEFAULT_PTY_EVENT_POLL_INTERVAL, TunnelSessionError};

const DIRECT_PTY_STREAM_ID: u32 = 1;
const PTY_SESSION_ERROR_CODE_CREATE_FAILED: &str = "pty_create_failed";
const PTY_SESSION_ERROR_CODE_ATTACH_FAILED: &str = "pty_attach_failed";

pub(super) fn handle_pty_session_control_message(
    message: PtySessionControlMessage,
    tunnel_writer_sender: &mpsc::UnboundedSender<TunnelWriterMessage>,
    cgroup_root: &Path,
    runtime_env: &BTreeMap<String, String>,
    sandbox_instance_id: &str,
) -> Result<(), TunnelSessionError> {
    let PtySessionControlMessage::Open(message) = message else {
        return Ok(());
    };

    let request = DirectPtyTransportRequest {
        cgroup_root: cgroup_root.to_path_buf(),
        runtime_env: runtime_env.clone(),
        sandbox_instance_id: sandbox_instance_id.to_string(),
        message,
    };
    let writer_sender = tunnel_writer_sender.clone();

    thread::spawn(move || {
        if let Err(error) = run_direct_pty_transport(request, writer_sender) {
            eprintln!("sandboxd direct pty transport failed: {error}");
        }
    });

    Ok(())
}

struct DirectPtyTransportRequest {
    cgroup_root: PathBuf,
    runtime_env: BTreeMap<String, String>,
    sandbox_instance_id: String,
    message: PtySessionOpen,
}

fn run_direct_pty_transport(
    request: DirectPtyTransportRequest,
    tunnel_writer_sender: mpsc::UnboundedSender<TunnelWriterMessage>,
) -> Result<(), TunnelSessionError> {
    let runtime = Builder::new_current_thread()
        .enable_all()
        .build()
        .map_err(|error| TunnelSessionError::Pty(error.to_string()))?;

    runtime.block_on(run_direct_pty_transport_async(
        request,
        tunnel_writer_sender,
    ))
}

async fn run_direct_pty_transport_async(
    request: DirectPtyTransportRequest,
    tunnel_writer_sender: mpsc::UnboundedSender<TunnelWriterMessage>,
) -> Result<(), TunnelSessionError> {
    if request.message.launch.session != PtySessionLaunchMode::Create {
        write_tunnel_text(
            &tunnel_writer_sender,
            pty_session_error(
                &request.message.request_id,
                &request.message.pty_session_id,
                PTY_SESSION_ERROR_CODE_ATTACH_FAILED,
                "direct PTY transport does not support attaching to an existing PTY session",
            ),
        )?;
        return Ok(());
    }

    let session = match start_scoped_pty_session(
        PtySpawnRequest {
            cwd: request.message.launch.cwd.clone(),
            cols: request.message.launch.cols,
            rows: request.message.launch.rows,
            command: request.message.launch.command.clone(),
            args: request.message.launch.args.clone(),
            env: request.runtime_env,
        },
        &request.cgroup_root,
        &request.sandbox_instance_id,
        &crate::time::SystemClock,
        &crate::time::ThreadSleeper,
    ) {
        Ok(session) => session,
        Err(error) => {
            write_tunnel_text(
                &tunnel_writer_sender,
                pty_session_error(
                    &request.message.request_id,
                    &request.message.pty_session_id,
                    PTY_SESSION_ERROR_CODE_CREATE_FAILED,
                    error.to_string(),
                ),
            )?;
            return Ok(());
        }
    };

    let (socket, _) = match connect_async(request.message.transport_url.as_str())
        .await
        .map_err(|error| TunnelSessionError::Pty(error.to_string()))
    {
        Ok(result) => result,
        Err(error) => {
            let _ = session.terminate(
                &crate::time::SystemClock,
                &crate::time::ThreadSleeper,
                DEFAULT_PTY_TERMINATE_POLL_INTERVAL,
                DEFAULT_PTY_TERMINATE_TIMEOUT_MS,
            );
            write_tunnel_text(
                &tunnel_writer_sender,
                pty_session_error(
                    &request.message.request_id,
                    &request.message.pty_session_id,
                    PTY_SESSION_ERROR_CODE_ATTACH_FAILED,
                    error.to_string(),
                ),
            )?;
            return Ok(());
        }
    };

    write_tunnel_text(
        &tunnel_writer_sender,
        pty_session_opened(&request.message.request_id, &request.message.pty_session_id),
    )?;

    let (mut socket_writer, mut socket_reader) = socket.split();
    let mut poll_interval = tokio::time::interval(DEFAULT_PTY_EVENT_POLL_INTERVAL);

    loop {
        tokio::select! {
            maybe_message = socket_reader.next() => {
                match maybe_message {
                    Some(Ok(Message::Binary(payload))) => {
                        session
                            .write(payload.as_ref())
                            .map_err(|error| TunnelSessionError::Pty(error.to_string()))?;
                    }
                    Some(Ok(Message::Text(payload))) => {
                        match parse_pty_control_message(payload.as_ref()) {
                            Ok(PtyControlMessage::Signal(message)) => {
                                session
                                    .resize(message.signal.cols, message.signal.rows)
                                    .map_err(|error| TunnelSessionError::Pty(error.to_string()))?;
                            }
                            Ok(PtyControlMessage::Close(_)) => {
                                let exit_code = session
                                    .terminate(
                                        &crate::time::SystemClock,
                                        &crate::time::ThreadSleeper,
                                        DEFAULT_PTY_TERMINATE_POLL_INTERVAL,
                                        DEFAULT_PTY_TERMINATE_TIMEOUT_MS,
                                    )
                                    .or_else(|_| {
                                        session.exit_code().ok_or_else(|| {
                                            TunnelSessionError::Pty(
                                                "PTY session did not report an exit code after close"
                                                    .to_string(),
                                            )
                                        })
                                    })?;
                                socket_writer
                                    .send(Message::Text(
                                        pty_exit_event(DIRECT_PTY_STREAM_ID, exit_code).into(),
                                    ))
                                    .await
                                    .map_err(|error| TunnelSessionError::Pty(error.to_string()))?;
                                return Ok(());
                            }
                            Ok(PtyControlMessage::Window(_)) => {}
                            Err(error) => {
                                socket_writer
                                    .send(Message::Text(
                                        stream_reset(
                                            DIRECT_PTY_STREAM_ID,
                                            STREAM_RESET_CODE_INVALID_STREAM_SIGNAL,
                                            error.to_string(),
                                        )
                                        .into(),
                                    ))
                                    .await
                                    .map_err(|error| TunnelSessionError::Pty(error.to_string()))?;
                            }
                        }
                    }
                    Some(Ok(Message::Ping(payload))) => {
                        socket_writer
                            .send(Message::Pong(payload))
                            .await
                            .map_err(|error| TunnelSessionError::Pty(error.to_string()))?;
                    }
                    Some(Ok(Message::Close(_))) | None => {
                        let _ = session.terminate(
                            &crate::time::SystemClock,
                            &crate::time::ThreadSleeper,
                            DEFAULT_PTY_TERMINATE_POLL_INTERVAL,
                            DEFAULT_PTY_TERMINATE_TIMEOUT_MS,
                        );
                        return Ok(());
                    }
                    Some(Ok(Message::Pong(_))) => {}
                    Some(Ok(_)) => {}
                    Some(Err(error)) => {
                        let _ = session.terminate(
                            &crate::time::SystemClock,
                            &crate::time::ThreadSleeper,
                            DEFAULT_PTY_TERMINATE_POLL_INTERVAL,
                            DEFAULT_PTY_TERMINATE_TIMEOUT_MS,
                        );
                        return Err(TunnelSessionError::Pty(error.to_string()));
                    }
                }
            }
            _ = poll_interval.tick() => {
                while let Some(event) = session
                    .next_event_timeout(Duration::from_millis(0))
                    .map_err(|error| TunnelSessionError::Pty(error.to_string()))?
                {
                    match event {
                        PtyEvent::Output(chunk) => {
                            socket_writer
                                .send(Message::Binary(chunk.into()))
                                .await
                                .map_err(|error| TunnelSessionError::Pty(error.to_string()))?;
                        }
                        PtyEvent::Exit(exit_code) => {
                            socket_writer
                                .send(Message::Text(
                                    pty_exit_event(DIRECT_PTY_STREAM_ID, exit_code).into(),
                                ))
                                .await
                                .map_err(|error| TunnelSessionError::Pty(error.to_string()))?;
                            return Ok(());
                        }
                        PtyEvent::Closed => {
                            if let Some(exit_code) = session.exit_code() {
                                socket_writer
                                    .send(Message::Text(
                                        pty_exit_event(DIRECT_PTY_STREAM_ID, exit_code).into(),
                                    ))
                                    .await
                                    .map_err(|error| TunnelSessionError::Pty(error.to_string()))?;
                                return Ok(());
                            }
                        }
                        PtyEvent::Error(message) => {
                            socket_writer
                                .send(Message::Text(
                                    stream_reset(
                                        DIRECT_PTY_STREAM_ID,
                                        STREAM_RESET_CODE_TARGET_CLOSED,
                                        message,
                                    )
                                    .into(),
                                ))
                                .await
                                .map_err(|error| TunnelSessionError::Pty(error.to_string()))?;
                            return Ok(());
                        }
                    }
                }
            }
        }
    }
}
