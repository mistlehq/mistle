//! File-upload state owned by the live tunnel session.

use std::fs::{self, File, OpenOptions};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};

use tokio::sync::mpsc;

use crate::time::Clock;
use crate::tunnel::protocol::{
    FILE_UPLOAD_RESET_CODE_BYTE_COUNT_MISMATCH, FILE_UPLOAD_RESET_CODE_INVALID_FILE_TYPE,
    FileUploadCompletedEventInput, file_upload_completed_event, stream_complete, stream_reset,
};
use crate::tunnel::session::TunnelSessionError;
use crate::tunnel::session::bootstrap::{TunnelWriterMessage, write_tunnel_text};
use crate::tunnel::upload_classification::{UploadClassificationError, classify_uploaded_file};

static UPLOAD_ID_COUNTER: AtomicU64 = AtomicU64::new(1);
const MAX_UPLOAD_SIZE_BYTES: usize = 16 * 1024 * 1024;
const MAX_UPLOAD_THREAD_ID_LENGTH: usize = 128;

pub(super) struct FileUploadState {
    pub(super) attachment_id: String,
    pub(super) thread_directory_path: PathBuf,
    pub(super) thread_id: String,
    pub(super) mime_type: String,
    pub(super) original_filename: String,
    pub(super) size_bytes: usize,
    pub(super) temp_path: PathBuf,
    pub(super) file: File,
    pub(super) received_bytes: usize,
}

pub(super) fn create_file_upload_state(
    message: &crate::tunnel::protocol::FileUploadStreamOpen,
    attachment_root: &Path,
    clock: &dyn Clock,
) -> Result<FileUploadState, String> {
    assert_upload_metadata(
        &message.channel.thread_id,
        &message.channel.mime_type,
        message.channel.size_bytes,
    )?;
    let thread_directory_path = attachment_root.join(&message.channel.thread_id);
    fs::create_dir_all(&thread_directory_path).map_err(|error| {
        format!(
            "failed to create upload thread directory {}: {error}",
            thread_directory_path.display()
        )
    })?;

    let attachment_id = format!(
        "att_{}_{}",
        clock.now_ms(),
        UPLOAD_ID_COUNTER.fetch_add(1, Ordering::Relaxed)
    );
    let temp_path = thread_directory_path.join(format!(".{attachment_id}.part"));
    let file = OpenOptions::new()
        .create_new(true)
        .write(true)
        .open(&temp_path)
        .map_err(|error| {
            format!(
                "failed to create temporary upload file {}: {error}",
                temp_path.display()
            )
        })?;

    Ok(FileUploadState {
        attachment_id,
        thread_directory_path,
        thread_id: message.channel.thread_id.clone(),
        mime_type: message.channel.mime_type.clone(),
        original_filename: message.channel.original_filename.clone(),
        size_bytes: message.channel.size_bytes,
        temp_path,
        file,
        received_bytes: 0,
    })
}

pub(super) fn finalize_file_upload(
    tunnel_writer_sender: &mpsc::UnboundedSender<TunnelWriterMessage>,
    stream_id: u32,
    upload_state: FileUploadState,
) -> Result<(), TunnelSessionError> {
    if upload_state.received_bytes != upload_state.size_bytes {
        write_tunnel_text(
            tunnel_writer_sender,
            stream_reset(
                stream_id,
                FILE_UPLOAD_RESET_CODE_BYTE_COUNT_MISMATCH,
                "uploaded byte count did not match declared size",
            ),
        )?;
        let _ = fs::remove_file(&upload_state.temp_path);
        return Ok(());
    }

    upload_state
        .file
        .sync_all()
        .map_err(|error| TunnelSessionError::FileUpload(error.to_string()))?;
    let classification = match classify_uploaded_file(
        &upload_state.mime_type,
        &upload_state.temp_path,
        &upload_state.original_filename,
    ) {
        Ok(classification) => classification,
        Err(UploadClassificationError::Io(message)) => {
            write_tunnel_text(
                tunnel_writer_sender,
                stream_reset(stream_id, FILE_UPLOAD_RESET_CODE_INVALID_FILE_TYPE, message),
            )?;
            let _ = fs::remove_file(&upload_state.temp_path);
            return Ok(());
        }
        Err(UploadClassificationError::Reset { code, message }) => {
            write_tunnel_text(tunnel_writer_sender, stream_reset(stream_id, code, message))?;
            let _ = fs::remove_file(&upload_state.temp_path);
            return Ok(());
        }
    };

    let final_path = upload_state.thread_directory_path.join(format!(
        "{}.{}",
        upload_state.attachment_id, classification.extension
    ));
    fs::rename(&upload_state.temp_path, &final_path)
        .map_err(|error| TunnelSessionError::FileUpload(error.to_string()))?;
    let final_path_text = final_path.to_string_lossy();
    write_tunnel_text(
        tunnel_writer_sender,
        file_upload_completed_event(FileUploadCompletedEventInput {
            stream_id,
            kind: classification.kind,
            attachment_id: &upload_state.attachment_id,
            thread_id: &upload_state.thread_id,
            original_filename: &upload_state.original_filename,
            mime_type: &upload_state.mime_type,
            size_bytes: upload_state.size_bytes,
            path: &final_path_text,
        }),
    )?;
    write_tunnel_text(tunnel_writer_sender, stream_complete(stream_id))?;

    Ok(())
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
