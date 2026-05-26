//! Archive verification and extraction for runtime artifact installs.
//!
//! GitHub downloads enter the sandbox as compressed tarballs. This module owns
//! checksum validation, path safety checks, extraction, and executable bit
//! preservation before install commands run.

use std::fs::{self, File};
use std::io::Read;
use std::os::unix::fs::PermissionsExt;
use std::path::{Component, Path, PathBuf};

use flate2::read::GzDecoder;
use sha2::{Digest, Sha256};
use tar::Archive;

use crate::runtime::artifact_install::*;

pub(super) fn verify_github_release_asset_sha256(
    download_path: &Path,
    expected_sha256: Option<&str>,
    failure_context: &str,
) -> Result<(), String> {
    let Some(expected_sha256) = expected_sha256 else {
        return Ok(());
    };
    let actual_sha256 = compute_file_sha256(download_path)?;
    if actual_sha256 != expected_sha256 {
        return Err(format!(
            "{failure_context}: sha256 mismatch expected {expected_sha256} got {actual_sha256}"
        ));
    }
    Ok(())
}

pub(super) fn compute_file_sha256(path: &Path) -> Result<String, String> {
    let mut file = File::open(path).map_err(|error| {
        format!("failed to open downloaded github release asset for sha256: {error}")
    })?;
    let mut hasher = Sha256::new();
    let mut buffer = [0_u8; 64 * 1024];
    loop {
        let read = file.read(&mut buffer).map_err(|error| {
            format!("failed to read downloaded github release asset for sha256: {error}")
        })?;
        if read == 0 {
            break;
        }
        hasher.update(&buffer[..read]);
    }
    Ok(bytes_to_lower_hex(hasher.finalize().as_ref()))
}

fn bytes_to_lower_hex(bytes: &[u8]) -> String {
    const HEX: &[u8; 16] = b"0123456789abcdef";

    let mut encoded = String::with_capacity(bytes.len() * 2);
    for byte in bytes {
        encoded.push(char::from(HEX[usize::from(byte >> 4)]));
        encoded.push(char::from(HEX[usize::from(byte & 0x0f)]));
    }
    encoded
}

pub(super) fn install_tar_gz_entry(
    archive_path: &Path,
    extracted_path: &str,
    staged_path: &Path,
) -> Result<(), String> {
    let target_path = Path::new(extracted_path);
    let archive_file = File::open(archive_path)
        .map_err(|error| format!("failed to open downloaded github release archive: {error}"))?;
    let mut archive = Archive::new(GzDecoder::new(archive_file));
    let mut found_entry = false;

    for entry_result in archive.entries().map_err(|error| {
        format!("failed to read github release tar.gz entries for {extracted_path}: {error}")
    })? {
        let mut entry = entry_result
            .map_err(|error| format!("failed to read github release tar.gz entry: {error}"))?;
        let entry_path = entry
            .path()
            .map_err(|error| {
                format!("failed to resolve github release tar.gz entry path: {error}")
            })?
            .into_owned();
        let relative_entry_path = if entry_path == target_path {
            PathBuf::new()
        } else {
            match entry_path.strip_prefix(target_path) {
                Ok(relative_path) if !relative_path.as_os_str().is_empty() => {
                    relative_path.to_path_buf()
                }
                _ => continue,
            }
        };
        validate_archive_relative_path(&relative_entry_path, &entry_path)?;

        let destination_path = if relative_entry_path.as_os_str().is_empty() {
            staged_path.to_path_buf()
        } else {
            staged_path.join(&relative_entry_path)
        };
        let entry_type = entry.header().entry_type();
        if entry_type.is_dir() {
            fs::create_dir_all(&destination_path).map_err(|error| {
                format!("failed to create staged install directory from tar.gz: {error}")
            })?;
            found_entry = true;
            continue;
        }
        if !entry_type.is_file() {
            return Err(format!(
                "github release tar.gz entry {} is not a regular file or directory",
                entry_path.display()
            ));
        }

        if let Some(parent_path) = destination_path.parent() {
            fs::create_dir_all(parent_path).map_err(|error| {
                format!("failed to create staged install parent directory from tar.gz: {error}")
            })?;
        }
        entry
            .unpack(&destination_path)
            .map_err(|error| format!("failed to extract github release tar.gz entry: {error}"))?;
        found_entry = true;
        if entry_path == target_path {
            break;
        }
    }

    if !found_entry {
        return Err(format!(
            "github release tar.gz did not contain extractedPath={extracted_path}"
        ));
    }
    Ok(())
}

pub(super) fn validate_archive_relative_path(
    relative_path: &Path,
    entry_path: &Path,
) -> Result<(), String> {
    for component in relative_path.components() {
        match component {
            Component::Normal(_) | Component::CurDir => {}
            Component::ParentDir | Component::RootDir | Component::Prefix(_) => {
                return Err(format!(
                    "github release tar.gz entry {} escapes extractedPath",
                    entry_path.display()
                ));
            }
        }
    }
    Ok(())
}

pub(super) fn install_parent_directory(install_path: &Path) -> &Path {
    install_path
        .parent()
        .filter(|parent| !parent.as_os_str().is_empty())
        .unwrap_or_else(|| Path::new("."))
}

pub(super) fn set_executable_permissions_if_file(path: &Path) -> Result<(), String> {
    let metadata = fs::metadata(path)
        .map_err(|error| format!("failed to read installed artifact metadata: {error}"))?;
    if metadata.is_file() {
        set_executable_permissions(path)?;
    }
    Ok(())
}

pub(super) fn set_executable_permissions(path: &Path) -> Result<(), String> {
    fs::set_permissions(path, fs::Permissions::from_mode(INSTALLED_BINARY_MODE))
        .map_err(|error| format!("failed to mark installed artifact executable: {error}"))
}
