//! Processes stream state owned by the live tunnel session.

use std::collections::BTreeMap;

use tokio::sync::mpsc;

use crate::time::Clock;
use crate::tunnel::protocol::{
    CONNECT_ERROR_CODE_PROCESSES_STREAM_UNAVAILABLE, PAYLOAD_KIND_WEBSOCKET_TEXT,
    ProcessesStreamMessage, STREAM_RESET_CODE_INVALID_STREAM_DATA,
    STREAM_RESET_CODE_PROCESSES_SNAPSHOT_FAILED, STREAM_RESET_CODE_STREAM_WINDOW_EXHAUSTED,
    StreamDataFrame, StreamSendWindow, encode_stream_data_frame, parse_processes_stream_message,
    stream_open_error, stream_open_ok, stream_reset, stream_window,
};
use crate::tunnel::runtime_processes::collect_processes_snapshot;
use crate::tunnel::session::{
    TunnelSessionError, TunnelWriterMessage, write_tunnel_binary, write_tunnel_text,
};

const DEFAULT_PROCESSES_SNAPSHOT_INTERVAL_MS: u64 = 500;

#[derive(Default)]
pub(super) struct ProcessStreamState {
    send_windows: BTreeMap<u32, StreamSendWindow>,
    last_snapshot_at_ms: Option<u64>,
}

impl ProcessStreamState {
    pub(super) fn is_active(&self, stream_id: u32) -> bool {
        self.send_windows.contains_key(&stream_id)
    }

    #[cfg(test)]
    pub(super) fn is_empty(&self) -> bool {
        self.send_windows.is_empty()
    }
}

pub(super) fn open_process_stream(
    tunnel_writer_sender: &mpsc::UnboundedSender<TunnelWriterMessage>,
    process_streams: &mut ProcessStreamState,
    stream_id: u32,
    clock: &dyn Clock,
) -> Result<(), TunnelSessionError> {
    if let Err(error) = collect_processes_snapshot(clock) {
        write_tunnel_text(
            tunnel_writer_sender,
            stream_open_error(
                stream_id,
                CONNECT_ERROR_CODE_PROCESSES_STREAM_UNAVAILABLE,
                error.to_string(),
            ),
        )?;
        return Ok(());
    }

    process_streams
        .send_windows
        .insert(stream_id, StreamSendWindow::default());
    write_tunnel_text(tunnel_writer_sender, stream_open_ok(stream_id))?;
    if let Err(error) = send_processes_snapshot(tunnel_writer_sender, process_streams, clock) {
        reset_process_streams(tunnel_writer_sender, process_streams, error.to_string())?;
    }
    Ok(())
}

pub(super) fn close_process_stream(
    process_streams: &mut ProcessStreamState,
    stream_id: u32,
) -> bool {
    process_streams.send_windows.remove(&stream_id).is_some()
}

pub(super) fn add_process_stream_window(
    process_streams: &mut ProcessStreamState,
    stream_id: u32,
    bytes: usize,
) -> Result<bool, TunnelSessionError> {
    let Some(send_window) = process_streams.send_windows.get_mut(&stream_id) else {
        return Ok(false);
    };
    send_window
        .add(bytes)
        .map_err(|error| TunnelSessionError::ParseControl(error.to_string()))?;
    Ok(true)
}

pub(super) fn poll_process_streams(
    tunnel_writer_sender: &mpsc::UnboundedSender<TunnelWriterMessage>,
    process_streams: &mut ProcessStreamState,
    clock: &dyn Clock,
) -> Result<(), TunnelSessionError> {
    if process_streams.send_windows.is_empty() {
        process_streams.last_snapshot_at_ms = None;
        return Ok(());
    }

    let now_ms = clock.now_ms();
    let should_send = process_streams
        .last_snapshot_at_ms
        .is_none_or(|last_snapshot_at_ms| {
            now_ms.saturating_sub(last_snapshot_at_ms) >= DEFAULT_PROCESSES_SNAPSHOT_INTERVAL_MS
        });
    if !should_send {
        return Ok(());
    }

    send_processes_snapshot_to_streams(tunnel_writer_sender, process_streams, clock)?;
    process_streams.last_snapshot_at_ms = Some(now_ms);
    Ok(())
}

pub(super) fn reset_process_streams(
    tunnel_writer_sender: &mpsc::UnboundedSender<TunnelWriterMessage>,
    process_streams: &mut ProcessStreamState,
    message: String,
) -> Result<(), TunnelSessionError> {
    let stream_ids = process_streams
        .send_windows
        .keys()
        .copied()
        .collect::<Vec<_>>();
    process_streams.send_windows.clear();

    for stream_id in stream_ids {
        write_tunnel_text(
            tunnel_writer_sender,
            stream_reset(
                stream_id,
                STREAM_RESET_CODE_PROCESSES_SNAPSHOT_FAILED,
                message.clone(),
            ),
        )?;
    }

    Ok(())
}

pub(super) fn handle_process_stream_frame(
    tunnel_writer_sender: &mpsc::UnboundedSender<TunnelWriterMessage>,
    process_streams: &mut ProcessStreamState,
    frame: StreamDataFrame,
    clock: &dyn Clock,
) -> Result<(), TunnelSessionError> {
    if frame.payload_kind != PAYLOAD_KIND_WEBSOCKET_TEXT {
        write_tunnel_text(
            tunnel_writer_sender,
            stream_reset(
                frame.stream_id,
                STREAM_RESET_CODE_INVALID_STREAM_DATA,
                "processes stream only accepts websocket text payloads",
            ),
        )?;
        close_process_stream(process_streams, frame.stream_id);
        return Ok(());
    }

    let payload = String::from_utf8(frame.payload)
        .map_err(|error| TunnelSessionError::ParseDataFrame(error.to_string()))?;
    match parse_processes_stream_message(&payload) {
        Ok(ProcessesStreamMessage::Refresh(_)) => {
            write_tunnel_text(
                tunnel_writer_sender,
                stream_window(frame.stream_id, payload.len()),
            )?;
            if let Err(error) =
                send_processes_snapshot_to_streams(tunnel_writer_sender, process_streams, clock)
            {
                reset_process_streams(tunnel_writer_sender, process_streams, error.to_string())?;
            } else {
                process_streams.last_snapshot_at_ms = Some(clock.now_ms());
            }
        }
        Ok(ProcessesStreamMessage::Snapshot(_)) => {
            write_tunnel_text(
                tunnel_writer_sender,
                stream_reset(
                    frame.stream_id,
                    STREAM_RESET_CODE_INVALID_STREAM_DATA,
                    "processes stream does not accept processes.snapshot payloads from the gateway",
                ),
            )?;
            close_process_stream(process_streams, frame.stream_id);
        }
        Err(error) => {
            write_tunnel_text(
                tunnel_writer_sender,
                stream_reset(
                    frame.stream_id,
                    STREAM_RESET_CODE_INVALID_STREAM_DATA,
                    error.to_string(),
                ),
            )?;
            close_process_stream(process_streams, frame.stream_id);
        }
    }
    Ok(())
}

fn send_processes_snapshot(
    tunnel_writer_sender: &mpsc::UnboundedSender<TunnelWriterMessage>,
    process_streams: &mut ProcessStreamState,
    clock: &dyn Clock,
) -> Result<(), TunnelSessionError> {
    send_processes_snapshot_to_streams(tunnel_writer_sender, process_streams, clock)?;
    process_streams.last_snapshot_at_ms = Some(clock.now_ms());
    Ok(())
}

fn send_processes_snapshot_to_streams(
    tunnel_writer_sender: &mpsc::UnboundedSender<TunnelWriterMessage>,
    process_streams: &mut ProcessStreamState,
    clock: &dyn Clock,
) -> Result<(), TunnelSessionError> {
    if process_streams.send_windows.is_empty() {
        return Ok(());
    }

    let snapshot = collect_processes_snapshot(clock)
        .map_err(|error| TunnelSessionError::Processes(error.to_string()))?;
    let payload = serde_json::to_string(&snapshot)
        .map_err(|error| TunnelSessionError::Processes(error.to_string()))?;
    let mut exhausted_stream_ids = Vec::new();

    for (stream_id, send_window) in &mut process_streams.send_windows {
        if !send_window.try_consume(payload.len()) {
            exhausted_stream_ids.push(*stream_id);
            continue;
        }

        let encoded =
            encode_stream_data_frame(*stream_id, PAYLOAD_KIND_WEBSOCKET_TEXT, payload.as_bytes())
                .map_err(|error| TunnelSessionError::ParseDataFrame(error.to_string()))?;
        write_tunnel_binary(tunnel_writer_sender, encoded)?;
    }

    for stream_id in exhausted_stream_ids {
        write_tunnel_text(
            tunnel_writer_sender,
            stream_reset(
                stream_id,
                STREAM_RESET_CODE_STREAM_WINDOW_EXHAUSTED,
                "processes stream send window is exhausted",
            ),
        )?;
        close_process_stream(process_streams, stream_id);
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use tokio::sync::mpsc;

    use crate::time::Clock;
    use crate::tunnel::protocol::{
        PAYLOAD_KIND_WEBSOCKET_BINARY, PAYLOAD_KIND_WEBSOCKET_TEXT, decode_stream_data_frame,
        encode_stream_data_frame,
    };
    use crate::tunnel::session::TunnelWriterMessage;
    use crate::tunnel::session::process::{
        ProcessStreamState, add_process_stream_window, close_process_stream,
        handle_process_stream_frame,
    };

    struct TestClock {
        now_ms: u64,
    }

    impl Clock for TestClock {
        fn now_ms(&self) -> u64 {
            self.now_ms
        }
    }

    #[test]
    fn close_process_stream_reports_whether_stream_was_active() {
        let mut process_streams = ProcessStreamState::default();

        assert!(!close_process_stream(&mut process_streams, 7));

        process_streams.send_windows.insert(7, Default::default());
        assert!(close_process_stream(&mut process_streams, 7));
        assert!(!process_streams.is_active(7));
    }

    #[test]
    fn add_process_stream_window_reports_unknown_stream_without_mutating_state() {
        let mut process_streams = ProcessStreamState::default();

        let handled = add_process_stream_window(&mut process_streams, 42, 128)
            .expect("window update should not fail for unknown stream");

        assert!(!handled);
        assert!(process_streams.is_empty());
    }

    #[tokio::test]
    async fn binary_process_stream_payload_resets_stream() {
        let (writer_sender, mut writer_receiver) = mpsc::unbounded_channel();
        let mut process_streams = ProcessStreamState::default();
        process_streams.send_windows.insert(9, Default::default());
        let frame = decode_stream_data_frame(
            &encode_stream_data_frame(9, PAYLOAD_KIND_WEBSOCKET_BINARY, b"not text")
                .expect("test frame should encode"),
        )
        .expect("test frame should decode");
        let clock = TestClock { now_ms: 1 };

        handle_process_stream_frame(&writer_sender, &mut process_streams, frame, &clock)
            .expect("process stream frame should be handled");

        assert!(!process_streams.is_active(9));
        let reset = writer_receiver
            .recv()
            .await
            .expect("reset frame should be queued");
        let TunnelWriterMessage::Text(reset) = reset else {
            panic!("expected text reset");
        };
        assert!(reset.contains("\"type\":\"stream.reset\""));
        assert!(reset.contains("\"streamId\":9"));
    }

    #[tokio::test]
    async fn process_stream_refresh_payload_returns_credit_before_snapshot() {
        let (writer_sender, mut writer_receiver) = mpsc::unbounded_channel();
        let mut process_streams = ProcessStreamState::default();
        process_streams.send_windows.insert(11, Default::default());
        let payload = serde_json::json!({ "type": "processes.refresh" }).to_string();
        let frame = decode_stream_data_frame(
            &encode_stream_data_frame(11, PAYLOAD_KIND_WEBSOCKET_TEXT, payload.as_bytes())
                .expect("test frame should encode"),
        )
        .expect("test frame should decode");
        let clock = TestClock { now_ms: 1 };

        handle_process_stream_frame(&writer_sender, &mut process_streams, frame, &clock)
            .expect("process stream refresh should be handled");

        let window = writer_receiver
            .recv()
            .await
            .expect("stream.window should be queued before snapshot");
        let TunnelWriterMessage::Text(window) = window else {
            panic!("expected text window");
        };
        assert!(window.contains("\"type\":\"stream.window\""));
        assert!(window.contains("\"streamId\":11"));
    }
}
