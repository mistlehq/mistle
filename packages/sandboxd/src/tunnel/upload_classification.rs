use std::fs::File;
use std::io::Read;
use std::path::Path;

use crate::tunnel::protocol::{
    FILE_UPLOAD_RESET_CODE_INVALID_FILE_TYPE, FILE_UPLOAD_RESET_CODE_MIME_TYPE_MISMATCH,
};

const UPLOADED_FILE_KIND_IMAGE: &str = "image";
const UPLOADED_FILE_KIND_FILE: &str = "file";
const DEFAULT_UPLOAD_EXTENSION: &str = "bin";
const MAX_UPLOAD_EXTENSION_LENGTH: usize = 16;

const PNG_SIGNATURE: &[u8] = &[0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const JPEG_SIGNATURE: &[u8] = &[0xff, 0xd8, 0xff];
const GIF87A_SIGNATURE: &[u8] = &[0x47, 0x49, 0x46, 0x38, 0x37, 0x61];
const GIF89A_SIGNATURE: &[u8] = &[0x47, 0x49, 0x46, 0x38, 0x39, 0x61];
const WEBP_RIFF_SIGNATURE: &[u8] = &[0x52, 0x49, 0x46, 0x46];
const WEBP_BRAND_SIGNATURE: &[u8] = &[0x57, 0x45, 0x42, 0x50];

pub struct UploadedFileClassification {
    pub kind: &'static str,
    pub extension: String,
}

pub enum UploadClassificationError {
    Io(String),
    Reset { code: &'static str, message: String },
}

pub fn classify_uploaded_file(
    declared_mime_type: &str,
    temp_path: &Path,
    original_filename: &str,
) -> Result<UploadedFileClassification, UploadClassificationError> {
    let mut file = File::open(temp_path).map_err(|error| {
        UploadClassificationError::Io(format!(
            "failed to open temporary upload file {}: {error}",
            temp_path.display()
        ))
    })?;
    let mut signature_bytes = [0_u8; 12];
    let bytes_read = file.read(&mut signature_bytes).map_err(|error| {
        UploadClassificationError::Io(format!(
            "failed to read upload signature from {}: {error}",
            temp_path.display()
        ))
    })?;
    let detected_mime_type = detect_supported_image_mime_type(&signature_bytes[..bytes_read]);
    let declared_image_extension = resolve_image_extension(declared_mime_type);
    if let Some(detected_mime_type) = detected_mime_type {
        if declared_image_extension.is_some() && detected_mime_type != declared_mime_type {
            return Err(UploadClassificationError::Reset {
                code: FILE_UPLOAD_RESET_CODE_MIME_TYPE_MISMATCH,
                message: format!(
                    "uploaded file content is '{detected_mime_type}', which does not match declared MIME type '{declared_mime_type}'"
                ),
            });
        }

        return Ok(UploadedFileClassification {
            kind: UPLOADED_FILE_KIND_IMAGE,
            extension: resolve_image_extension(detected_mime_type)
                .expect("detected supported image MIME type should have an extension")
                .to_string(),
        });
    }
    if declared_image_extension.is_some() {
        return Err(UploadClassificationError::Reset {
            code: FILE_UPLOAD_RESET_CODE_INVALID_FILE_TYPE,
            message: "uploaded file is not a supported image".to_string(),
        });
    }

    Ok(UploadedFileClassification {
        kind: UPLOADED_FILE_KIND_FILE,
        extension: resolve_generic_upload_extension(original_filename),
    })
}

fn resolve_image_extension(mime_type: &str) -> Option<&'static str> {
    match mime_type {
        "image/png" => Some("png"),
        "image/jpeg" => Some("jpg"),
        "image/webp" => Some("webp"),
        "image/gif" => Some("gif"),
        _ => None,
    }
}

fn resolve_generic_upload_extension(original_filename: &str) -> String {
    if original_filename.contains('/') || original_filename.contains('\\') {
        return DEFAULT_UPLOAD_EXTENSION.to_string();
    }

    let Some(extension) = Path::new(original_filename)
        .extension()
        .and_then(|value| value.to_str())
    else {
        return DEFAULT_UPLOAD_EXTENSION.to_string();
    };
    let normalized_extension = extension.to_ascii_lowercase();
    if normalized_extension.is_empty()
        || normalized_extension.len() > MAX_UPLOAD_EXTENSION_LENGTH
        || !normalized_extension
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric())
    {
        return DEFAULT_UPLOAD_EXTENSION.to_string();
    }

    normalized_extension
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
