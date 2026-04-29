//! File-upload stream handling for the bootstrap tunnel.
//!
//! The gateway uploads sandbox attachments over one `fileUpload` stream. This
//! module validates the declared metadata, writes the byte stream to a temporary
//! file, classifies image uploads from content signatures, and emits the final
//! `fileUpload.completed` event once the persisted attachment path is ready.

use std::fmt::{self, Display};
use std::fs::{self, File, OpenOptions};
use std::io::{self, Write};
use std::net::TcpStream;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};

use tungstenite::{Message, WebSocket};

use crate::time::Clock;
use crate::tunnel::protocol::{
    CONNECT_ERROR_CODE_INVALID_CONNECT_REQUEST, FILE_UPLOAD_RESET_CODE_BYTE_COUNT_EXCEEDED,
    FILE_UPLOAD_RESET_CODE_BYTE_COUNT_MISMATCH, FileUploadCompletedEventInput,
    PAYLOAD_KIND_RAW_BYTES, STREAM_RESET_CODE_INVALID_STREAM_DATA, StreamControlMessage,
    decode_stream_data_frame, file_upload_completed_event, parse_stream_control_message,
    stream_complete, stream_open_error, stream_open_ok, stream_reset, stream_window,
};
use crate::tunnel::upload_classification::{UploadClassificationError, classify_uploaded_file};

static UPLOAD_ID_COUNTER: AtomicU64 = AtomicU64::new(1);
const MAX_UPLOAD_SIZE_BYTES: usize = 16 * 1024 * 1024;
const MAX_UPLOAD_THREAD_ID_LENGTH: usize = 128;

/// Describes why one file-upload relay step failed.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct FileUploadError {
    message: String,
}

impl FileUploadError {
    fn new(message: impl Into<String>) -> Self {
        Self {
            message: message.into(),
        }
    }
}

impl Display for FileUploadError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(&self.message)
    }
}

impl std::error::Error for FileUploadError {}

/// Starts one file-upload relay from an initial `stream.open` payload.
pub fn relay_file_upload_stream(
    socket: &mut WebSocket<TcpStream>,
    open_payload: &str,
    attachment_root_path: &Path,
    clock: &dyn Clock,
) -> Result<(), FileUploadError> {
    let open_message = match parse_stream_control_message(open_payload) {
        Ok(StreamControlMessage::OpenFileUpload(message)) => message,
        Ok(_) => {
            return Err(FileUploadError::new(
                "expected initial file upload stream.open control message",
            ));
        }
        Err(error) => {
            return Err(FileUploadError::new(error.to_string()));
        }
    };

    if let Err(error) = assert_upload_metadata(
        &open_message.channel.thread_id,
        &open_message.channel.mime_type,
        open_message.channel.size_bytes,
    ) {
        write_text_frame(
            socket,
            stream_open_error(
                open_message.stream_id,
                CONNECT_ERROR_CODE_INVALID_CONNECT_REQUEST,
                error,
            ),
        )?;
        return Ok(());
    }

    let thread_directory_path =
        derive_upload_thread_directory_path(attachment_root_path, &open_message.channel.thread_id)?;
    fs::create_dir_all(&thread_directory_path).map_err(|error| {
        FileUploadError::new(format!(
            "failed to create upload thread directory {}: {error}",
            thread_directory_path.display()
        ))
    })?;

    let attachment_id = format!(
        "att_{}_{}",
        clock.now_ms(),
        UPLOAD_ID_COUNTER.fetch_add(1, Ordering::Relaxed)
    );
    let temp_path = thread_directory_path.join(format!(".{attachment_id}.part"));
    let mut file = OpenOptions::new()
        .create_new(true)
        .write(true)
        .open(&temp_path)
        .map_err(|error| {
            FileUploadError::new(format!(
                "failed to create temporary upload file {}: {error}",
                temp_path.display()
            ))
        })?;

    write_text_frame(socket, stream_open_ok(open_message.stream_id))?;

    let upload_result = run_upload_loop(
        socket,
        &mut file,
        &open_message,
        &temp_path,
        &thread_directory_path,
        &attachment_id,
    );
    match upload_result {
        Ok(()) => {
            if let Err(error) = fs::remove_file(&temp_path)
                && error.kind() != io::ErrorKind::NotFound
            {
                return Err(FileUploadError::new(format!(
                    "failed to clean up temporary upload file {}: {error}",
                    temp_path.display()
                )));
            }
            Ok(())
        }
        Err(error) => {
            let _ = fs::remove_file(&temp_path);
            Err(error)
        }
    }
}

fn run_upload_loop(
    socket: &mut WebSocket<TcpStream>,
    file: &mut File,
    open_message: &crate::tunnel::protocol::FileUploadStreamOpen,
    temp_path: &Path,
    thread_directory_path: &Path,
    attachment_id: &str,
) -> Result<(), FileUploadError> {
    let mut received_bytes = 0_usize;

    loop {
        match socket.read() {
            Ok(Message::Binary(payload)) => {
                let frame = match decode_stream_data_frame(payload.as_ref()) {
                    Ok(frame) => frame,
                    Err(error) => {
                        write_text_frame(
                            socket,
                            stream_reset(
                                open_message.stream_id,
                                STREAM_RESET_CODE_INVALID_STREAM_DATA,
                                error.to_string(),
                            ),
                        )?;
                        return Ok(());
                    }
                };
                if frame.stream_id != open_message.stream_id {
                    write_text_frame(
                        socket,
                        stream_reset(
                            frame.stream_id,
                            STREAM_RESET_CODE_INVALID_STREAM_DATA,
                            format!(
                                "stream data frame streamId {} does not match active upload stream {}",
                                frame.stream_id, open_message.stream_id
                            ),
                        ),
                    )?;
                    return Ok(());
                }
                if frame.payload_kind != PAYLOAD_KIND_RAW_BYTES {
                    write_text_frame(
                        socket,
                        stream_reset(
                            open_message.stream_id,
                            STREAM_RESET_CODE_INVALID_STREAM_DATA,
                            "file upload stream only accepts raw byte payloads",
                        ),
                    )?;
                    return Ok(());
                }

                received_bytes = received_bytes.saturating_add(frame.payload.len());
                if received_bytes > open_message.channel.size_bytes {
                    write_text_frame(
                        socket,
                        stream_reset(
                            open_message.stream_id,
                            FILE_UPLOAD_RESET_CODE_BYTE_COUNT_EXCEEDED,
                            "received more bytes than declared by the upload metadata",
                        ),
                    )?;
                    return Ok(());
                }

                file.write_all(&frame.payload).map_err(|error| {
                    FileUploadError::new(format!(
                        "failed to write upload bytes to {}: {error}",
                        temp_path.display()
                    ))
                })?;
                write_text_frame(
                    socket,
                    stream_window(open_message.stream_id, frame.payload.len()),
                )?;
            }
            Ok(Message::Text(payload)) => {
                let control_message = match parse_stream_control_message(payload.as_str()) {
                    Ok(message) => message,
                    Err(error) => {
                        write_text_frame(
                            socket,
                            stream_open_error(
                                open_message.stream_id,
                                CONNECT_ERROR_CODE_INVALID_CONNECT_REQUEST,
                                error.to_string(),
                            ),
                        )?;
                        return Ok(());
                    }
                };

                let StreamControlMessage::Close(message) = control_message else {
                    write_text_frame(
                        socket,
                        stream_reset(
                            open_message.stream_id,
                            STREAM_RESET_CODE_INVALID_STREAM_DATA,
                            "file upload stream only accepts stream.close after stream.open",
                        ),
                    )?;
                    return Ok(());
                };
                if message.stream_id != open_message.stream_id {
                    write_text_frame(
                        socket,
                        stream_reset(
                            message.stream_id,
                            STREAM_RESET_CODE_INVALID_STREAM_DATA,
                            format!(
                                "stream.close streamId {} does not match active upload stream {}",
                                message.stream_id, open_message.stream_id
                            ),
                        ),
                    )?;
                    return Ok(());
                }
                if received_bytes != open_message.channel.size_bytes {
                    write_text_frame(
                        socket,
                        stream_reset(
                            open_message.stream_id,
                            FILE_UPLOAD_RESET_CODE_BYTE_COUNT_MISMATCH,
                            "uploaded byte count did not match declared size",
                        ),
                    )?;
                    return Ok(());
                }

                file.sync_all().map_err(|error| {
                    FileUploadError::new(format!(
                        "failed to flush temporary upload file {}: {error}",
                        temp_path.display()
                    ))
                })?;
                let classification = match classify_uploaded_file(
                    &open_message.channel.mime_type,
                    temp_path,
                    &open_message.channel.original_filename,
                ) {
                    Ok(classification) => classification,
                    Err(UploadClassificationError::Io(message)) => {
                        return Err(FileUploadError::new(message));
                    }
                    Err(UploadClassificationError::Reset { code, message }) => {
                        write_text_frame(
                            socket,
                            stream_reset(open_message.stream_id, code, message),
                        )?;
                        return Ok(());
                    }
                };
                let final_path = thread_directory_path
                    .join(format!("{attachment_id}.{}", classification.extension));
                fs::rename(temp_path, &final_path).map_err(|error| {
                    FileUploadError::new(format!(
                        "failed to persist uploaded file {}: {error}",
                        final_path.display()
                    ))
                })?;

                let final_path_text = final_path.to_string_lossy();
                write_text_frame(
                    socket,
                    file_upload_completed_event(FileUploadCompletedEventInput {
                        stream_id: open_message.stream_id,
                        kind: classification.kind,
                        attachment_id,
                        thread_id: &open_message.channel.thread_id,
                        original_filename: &open_message.channel.original_filename,
                        mime_type: &open_message.channel.mime_type,
                        size_bytes: open_message.channel.size_bytes,
                        path: &final_path_text,
                    }),
                )?;
                write_text_frame(socket, stream_complete(open_message.stream_id))?;
                return Ok(());
            }
            Ok(Message::Close(_)) | Err(tungstenite::Error::ConnectionClosed) => {
                return Ok(());
            }
            Ok(Message::Ping(payload)) => {
                socket.send(Message::Pong(payload)).map_err(|error| {
                    FileUploadError::new(format!("failed to reply to tunnel ping: {error}"))
                })?;
            }
            Ok(Message::Pong(_)) | Ok(Message::Frame(_)) => {}
            Err(error) => {
                return Err(FileUploadError::new(format!(
                    "failed to read file upload tunnel message: {error}"
                )));
            }
        }
    }
}

fn assert_upload_metadata(
    thread_id: &str,
    mime_type: &str,
    size_bytes: usize,
) -> Result<(), String> {
    assert_safe_upload_thread_id(thread_id)?;
    if mime_type.trim().is_empty() {
        return Err("mimeType is required.".to_string());
    }
    if size_bytes == 0 {
        return Err("sizeBytes must be greater than 0.".to_string());
    }
    if size_bytes > MAX_UPLOAD_SIZE_BYTES {
        return Err("sizeBytes exceeds the configured upload limit.".to_string());
    }
    Ok(())
}

fn assert_safe_upload_thread_id(thread_id: &str) -> Result<(), String> {
    let trimmed_thread_id = thread_id.trim();
    if trimmed_thread_id.is_empty() {
        return Err("threadId is required.".to_string());
    }
    if trimmed_thread_id != thread_id {
        return Err("threadId must not include leading or trailing whitespace.".to_string());
    }
    if thread_id.len() > MAX_UPLOAD_THREAD_ID_LENGTH {
        return Err("threadId exceeds the configured length limit.".to_string());
    }
    if !thread_id
        .bytes()
        .all(|byte| byte.is_ascii_alphanumeric() || byte == b'_' || byte == b'-')
    {
        return Err("threadId must use only ASCII letters, digits, '_' or '-'.".to_string());
    }
    Ok(())
}

fn derive_upload_thread_directory_path(
    attachment_root_path: &Path,
    thread_id: &str,
) -> Result<PathBuf, FileUploadError> {
    assert_safe_upload_thread_id(thread_id).map_err(FileUploadError::new)?;
    Ok(attachment_root_path.join(thread_id))
}

fn write_text_frame<S>(socket: &mut WebSocket<S>, payload: String) -> Result<(), FileUploadError>
where
    S: io::Read + io::Write,
{
    socket.send(Message::Text(payload.into())).map_err(|error| {
        FileUploadError::new(format!(
            "failed to write file upload control frame: {error}"
        ))
    })
}
