use std::collections::BTreeMap;
use std::fs::{File, read_dir};
use std::io::Read;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

use serde_json::{Value, json};

use crate::pi_proxy::PiProxyError;

const PI_SESSION_DIR_ENV: &str = "PI_CODING_AGENT_SESSION_DIR";

pub(super) struct PiRecentSessionCandidate {
    pub(super) created_at: Option<String>,
    pub(super) cwd: Option<String>,
    pub(super) id: String,
    pub(super) modified: SystemTime,
    pub(super) title: Option<String>,
    pub(super) path: PathBuf,
}

#[derive(Debug, Clone)]
struct PiSessionFileHeader {
    created_at: Option<String>,
    cwd: Option<String>,
    id: String,
    title: Option<String>,
}

pub(super) fn find_recent_conversation(
    env: &BTreeMap<String, String>,
    cwd: Option<&str>,
) -> Result<Option<PiRecentSessionCandidate>, PiProxyError> {
    let candidates = collect_session_candidates(env, cwd)?;
    Ok(candidates.into_iter().next())
}

pub(super) fn find_conversation_by_id(
    env: &BTreeMap<String, String>,
    provider_conversation_id: &str,
) -> Result<PiRecentSessionCandidate, PiProxyError> {
    collect_session_candidates(env, None)?
        .into_iter()
        .find(|candidate| candidate.id == provider_conversation_id)
        .ok_or_else(|| {
            PiProxyError::InvalidRequest(format!(
                "Pi conversation '{provider_conversation_id}' was not found"
            ))
        })
}

pub(super) fn list_conversations(
    env: &BTreeMap<String, String>,
    cwd: Option<&str>,
    limit: usize,
) -> Result<Value, PiProxyError> {
    if limit == 0 {
        return Err(PiProxyError::InvalidRequest(
            "limit must be greater than zero".to_string(),
        ));
    }

    let candidates = collect_session_candidates(env, cwd)?
        .into_iter()
        .filter_map(|candidate| {
            let candidate_cwd = candidate.cwd.clone()?;
            Some((candidate, candidate_cwd))
        })
        .collect::<Vec<_>>();
    let has_more = candidates.len() > limit;
    let conversations = candidates
        .into_iter()
        .take(limit)
        .map(|(candidate, candidate_cwd)| {
            json!({
                "id": candidate.id,
                "sessionFile": candidate.path.to_string_lossy().to_string(),
                "cwd": candidate_cwd,
                "title": candidate.title,
                "createdAt": candidate.created_at,
                "updatedAt": system_time_to_unix_millis(candidate.modified),
            })
        })
        .collect::<Vec<_>>();

    Ok(json!({
        "conversations": conversations,
        "hasMore": has_more,
    }))
}

fn collect_session_candidates(
    env: &BTreeMap<String, String>,
    cwd: Option<&str>,
) -> Result<Vec<PiRecentSessionCandidate>, PiProxyError> {
    let session_dir = session_dir(env)?;
    let mut candidates = Vec::new();
    let mut pending_directories = vec![PathBuf::from(session_dir)];

    while let Some(directory) = pending_directories.pop() {
        let entries = match read_dir(&directory) {
            Ok(entries) => entries,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
                if directory == Path::new(session_dir) {
                    return Ok(Vec::new());
                }
                continue;
            }
            Err(error) => return Err(PiProxyError::InvalidRequest(error.to_string())),
        };

        for entry_result in entries {
            let entry =
                entry_result.map_err(|error| PiProxyError::InvalidRequest(error.to_string()))?;
            let file_type = entry
                .file_type()
                .map_err(|error| PiProxyError::InvalidRequest(error.to_string()))?;
            if file_type.is_dir() {
                pending_directories.push(entry.path());
                continue;
            }
            if !file_type.is_file() {
                continue;
            }

            let path = entry.path();
            if path.extension().and_then(|extension| extension.to_str()) != Some("jsonl") {
                continue;
            }
            let header = match read_pi_session_file_header(&path) {
                Some(header) => header,
                None => continue,
            };
            if !is_matching_pi_session_file_header(&header, cwd) {
                continue;
            }
            let metadata = entry
                .metadata()
                .map_err(|error| PiProxyError::InvalidRequest(error.to_string()))?;
            let modified = metadata
                .modified()
                .map_err(|error| PiProxyError::InvalidRequest(error.to_string()))?;
            candidates.push(PiRecentSessionCandidate {
                created_at: header.created_at,
                cwd: header.cwd,
                id: header.id,
                modified,
                title: header.title,
                path,
            });
        }
    }

    candidates.sort_by(|left, right| right.modified.cmp(&left.modified));
    Ok(candidates)
}

fn session_dir(env: &BTreeMap<String, String>) -> Result<&str, PiProxyError> {
    env.get(PI_SESSION_DIR_ENV)
        .map(String::as_str)
        .filter(|value| !value.trim().is_empty())
        .ok_or(PiProxyError::MissingSessionDir)
}

fn read_pi_session_file_header(path: &Path) -> Option<PiSessionFileHeader> {
    let mut file = match File::open(path) {
        Ok(file) => file,
        Err(_) => return None,
    };
    let mut buffer = [0_u8; 8192];
    let bytes_read = match file.read(&mut buffer) {
        Ok(bytes_read) => bytes_read,
        Err(_) => return None,
    };
    if bytes_read == 0 {
        return None;
    }
    let first_line = String::from_utf8_lossy(&buffer[..bytes_read])
        .lines()
        .next()
        .unwrap_or("")
        .to_string();
    let header = match serde_json::from_str::<Value>(&first_line) {
        Ok(header) => header,
        Err(_) => return None,
    };
    let id = header["id"].as_str()?;
    if header["type"].as_str() != Some("session") {
        return None;
    }

    Some(PiSessionFileHeader {
        created_at: header["timestamp"].as_str().map(ToString::to_string),
        cwd: header["cwd"].as_str().map(ToString::to_string),
        id: id.to_string(),
        title: header["sessionName"]
            .as_str()
            .or_else(|| header["title"].as_str())
            .map(ToString::to_string),
    })
}

fn is_matching_pi_session_file_header(header: &PiSessionFileHeader, cwd: Option<&str>) -> bool {
    match cwd {
        Some(expected_cwd) => header.cwd.as_deref() == Some(expected_cwd),
        None => true,
    }
}

fn system_time_to_unix_millis(time: SystemTime) -> Option<u64> {
    time.duration_since(UNIX_EPOCH)
        .ok()
        .and_then(|duration| u64::try_from(duration.as_millis()).ok())
}
