//! File-upload stream handling for the bootstrap tunnel.
//!
//! The gateway uploads supported image attachments over one `fileUpload`
//! stream. This module validates the declared metadata, writes the byte stream
//! to a temporary file, verifies the uploaded image signature against the
//! declared MIME type, and emits the final `fileUpload.completed` event once
//! the persisted attachment path is ready for later consumers.

use std::fmt::{self, Display};
use std::fs::{self, File, OpenOptions};
use std::io::{self, Read, Write};
use std::net::TcpStream;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};

use tungstenite::{Message, WebSocket};

use crate::time::Clock;
use crate::tunnel::protocol::{
    CONNECT_ERROR_CODE_INVALID_CONNECT_REQUEST, FILE_UPLOAD_RESET_CODE_BYTE_COUNT_EXCEEDED,
    FILE_UPLOAD_RESET_CODE_BYTE_COUNT_MISMATCH, FILE_UPLOAD_RESET_CODE_INVALID_FILE_TYPE,
    FILE_UPLOAD_RESET_CODE_MIME_TYPE_MISMATCH, PAYLOAD_KIND_RAW_BYTES,
    STREAM_RESET_CODE_INVALID_STREAM_DATA, StreamControlMessage, decode_stream_data_frame,
    file_upload_completed_event, parse_stream_control_message, stream_complete, stream_open_error,
    stream_open_ok, stream_reset, stream_window,
};

static UPLOAD_ID_COUNTER: AtomicU64 = AtomicU64::new(1);
const MAX_UPLOAD_SIZE_BYTES: usize = 10 * 1024 * 1024;
const MAX_UPLOAD_THREAD_ID_LENGTH: usize = 128;

const PNG_SIGNATURE: &[u8] = &[0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const JPEG_SIGNATURE: &[u8] = &[0xff, 0xd8, 0xff];
const GIF87A_SIGNATURE: &[u8] = &[0x47, 0x49, 0x46, 0x38, 0x37, 0x61];
const GIF89A_SIGNATURE: &[u8] = &[0x47, 0x49, 0x46, 0x38, 0x39, 0x61];
const WEBP_RIFF_SIGNATURE: &[u8] = &[0x52, 0x49, 0x46, 0x46];
const WEBP_BRAND_SIGNATURE: &[u8] = &[0x57, 0x45, 0x42, 0x50];

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

enum FileUploadValidationError {
    Internal(FileUploadError),
    Reset { code: &'static str, message: String },
}

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
    let extension =
        resolve_image_extension(&open_message.channel.mime_type).map_err(FileUploadError::new)?;
    let temp_path = thread_directory_path.join(format!(".{attachment_id}.part"));
    let final_path = thread_directory_path.join(format!("{attachment_id}.{extension}"));
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

    let upload_result = run_upload_loop(socket, &mut file, &open_message, &temp_path, &final_path);
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
    final_path: &Path,
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
                match validate_uploaded_image(
                    &open_message.channel.mime_type,
                    temp_path,
                    final_path,
                ) {
                    Ok(()) => {}
                    Err(FileUploadValidationError::Internal(error)) => {
                        return Err(error);
                    }
                    Err(FileUploadValidationError::Reset { code, message }) => {
                        write_text_frame(
                            socket,
                            stream_reset(open_message.stream_id, code, message),
                        )?;
                        return Ok(());
                    }
                }
                fs::rename(temp_path, final_path).map_err(|error| {
                    FileUploadError::new(format!(
                        "failed to persist uploaded file {}: {error}",
                        final_path.display()
                    ))
                })?;

                let final_path_text = final_path.to_string_lossy();
                write_text_frame(
                    socket,
                    file_upload_completed_event(
                        open_message.stream_id,
                        final_path
                            .file_stem()
                            .and_then(|value| value.to_str())
                            .unwrap_or("attachment"),
                        &open_message.channel.thread_id,
                        &open_message.channel.original_filename,
                        &open_message.channel.mime_type,
                        open_message.channel.size_bytes,
                        &final_path_text,
                    ),
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
    resolve_image_extension(mime_type)?;
    Ok(())
}

fn resolve_image_extension(mime_type: &str) -> Result<&'static str, String> {
    match mime_type {
        "image/png" => Ok("png"),
        "image/jpeg" => Ok("jpg"),
        "image/webp" => Ok("webp"),
        "image/gif" => Ok("gif"),
        _ => Err(format!("Unsupported image MIME type '{mime_type}'.")),
    }
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

fn validate_uploaded_image(
    declared_mime_type: &str,
    temp_path: &Path,
    final_path: &Path,
) -> Result<(), FileUploadValidationError> {
    let mut file = File::open(temp_path).map_err(|error| {
        FileUploadValidationError::Internal(FileUploadError::new(format!(
            "failed to open temporary upload file {}: {error}",
            temp_path.display()
        )))
    })?;
    let mut signature_bytes = [0_u8; 12];
    let bytes_read = file.read(&mut signature_bytes).map_err(|error| {
        FileUploadValidationError::Internal(FileUploadError::new(format!(
            "failed to read upload signature from {}: {error}",
            temp_path.display()
        )))
    })?;
    let detected_mime_type = detect_supported_image_mime_type(&signature_bytes[..bytes_read]);
    let Some(detected_mime_type) = detected_mime_type else {
        return Err(FileUploadValidationError::Reset {
            code: FILE_UPLOAD_RESET_CODE_INVALID_FILE_TYPE,
            message: "uploaded file is not a supported image".to_string(),
        });
    };
    if detected_mime_type != declared_mime_type {
        return Err(FileUploadValidationError::Reset {
            code: FILE_UPLOAD_RESET_CODE_MIME_TYPE_MISMATCH,
            message: format!(
                "uploaded file content is '{detected_mime_type}', which does not match declared MIME type '{declared_mime_type}'"
            ),
        });
    }
    if final_path.parent().is_none() {
        return Err(FileUploadValidationError::Internal(FileUploadError::new(
            "final upload path must include a parent directory",
        )));
    }
    Ok(())
}

fn detect_supported_image_mime_type(bytes: &[u8]) -> Option<&'static str> {
    if matches_signature(bytes, 0, PNG_SIGNATURE) {
        return Some("image/png");
    }
    if matches_signature(bytes, 0, JPEG_SIGNATURE) {
        return Some("image/jpeg");
    }
    if matches_signature(bytes, 0, GIF87A_SIGNATURE)
        || matches_signature(bytes, 0, GIF89A_SIGNATURE)
    {
        return Some("image/gif");
    }
    if matches_signature(bytes, 0, WEBP_RIFF_SIGNATURE)
        && matches_signature(bytes, 8, WEBP_BRAND_SIGNATURE)
    {
        return Some("image/webp");
    }
    None
}

fn matches_signature(bytes: &[u8], offset: usize, signature: &[u8]) -> bool {
    if bytes.len() < offset.saturating_add(signature.len()) {
        return false;
    }
    signature
        .iter()
        .enumerate()
        .all(|(index, value)| bytes[offset + index] == *value)
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
