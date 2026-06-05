//! File materialization for runtime client setup files.
//!
//! Setup-file specs may create or append files before processes start. This
//! module owns directory permissions, write modes, and error messages for those
//! filesystem operations.

use std::fs::{self, DirBuilder, OpenOptions};
use std::io::Write;
use std::os::unix::fs::{DirBuilderExt, OpenOptionsExt, PermissionsExt};
use std::path::Path;

use serde_json::Value;

use super::plan::{RuntimeClientSetupFile, RuntimeFileWriteMode};

const MANAGED_BLOCK_START_MARKER: &str = "<!-- MISTLE-MANAGED:START mistle-sandbox-context -->";
const MANAGED_BLOCK_END_MARKER: &str = "<!-- MISTLE-MANAGED:END mistle-sandbox-context -->";

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RuntimeFileApplyOutcome {
    Written,
    SkippedIfAbsent,
}

pub fn apply_runtime_file(
    file: &RuntimeClientSetupFile,
) -> Result<RuntimeFileApplyOutcome, String> {
    let parent_directory = Path::new(&file.path)
        .parent()
        .ok_or_else(|| format!("runtime file path {} has no parent directory", file.path))?;

    DirBuilder::new()
        .recursive(true)
        .mode(0o755)
        .create(parent_directory)
        .map_err(|error| {
            format!(
                "failed to create parent directory {}: {error}",
                parent_directory.display()
            )
        })?;

    if matches!(file.write_mode, Some(RuntimeFileWriteMode::IfAbsent))
        && Path::new(&file.path).exists()
    {
        return Ok(RuntimeFileApplyOutcome::SkippedIfAbsent);
    }

    let content = match file.write_mode {
        Some(RuntimeFileWriteMode::Merge) => merge_runtime_file(file)?,
        _ => file.content.clone(),
    };

    let mut output_file = OpenOptions::new()
        .create(true)
        .truncate(true)
        .write(true)
        .mode(file.mode)
        .open(&file.path)
        .map_err(|error| format!("failed to write file {}: {error}", file.path))?;
    output_file
        .write_all(content.as_bytes())
        .map_err(|error| format!("failed to write file {}: {error}", file.path))?;
    fs::set_permissions(&file.path, fs::Permissions::from_mode(file.mode))
        .map_err(|error| format!("failed to set file mode for {}: {error}", file.path))?;

    Ok(RuntimeFileApplyOutcome::Written)
}

fn merge_runtime_file(file: &RuntimeClientSetupFile) -> Result<String, String> {
    let existing_content = match fs::read_to_string(&file.path) {
        Ok(content) => content,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            return Ok(file.content.clone());
        }
        Err(error) => return Err(format!("failed to read file {}: {error}", file.path)),
    };

    if contains_managed_block(&file.content) {
        return Ok(merge_managed_block(&existing_content, &file.content));
    }

    if let Some(merged_json) = try_merge_json_file(file, &existing_content)? {
        return Ok(merged_json);
    }

    if looks_like_toml(&file.path, &file.content) {
        return Ok(merge_toml_file(&existing_content, &file.content));
    }

    Err(format!(
        "runtime file {} uses writeMode merge, but sandboxd could not infer a supported merge format",
        file.path
    ))
}

fn contains_managed_block(content: &str) -> bool {
    content.contains(MANAGED_BLOCK_START_MARKER) && content.contains(MANAGED_BLOCK_END_MARKER)
}

fn try_merge_json_file(
    file: &RuntimeClientSetupFile,
    existing_content: &str,
) -> Result<Option<String>, String> {
    let generated_json = match serde_json::from_str::<Value>(&file.content) {
        Ok(value) => value,
        Err(error) => {
            if file.path.ends_with(".json") {
                return Err(format!(
                    "runtime file {} uses writeMode merge for JSON, but generated content is invalid JSON: {error}",
                    file.path
                ));
            }
            return Ok(None);
        }
    };

    if !generated_json.is_object() {
        return Err(format!(
            "runtime file {} uses writeMode merge for JSON, but generated content is not a JSON object",
            file.path
        ));
    }

    let mut existing_json =
        serde_json::from_str::<Value>(existing_content).map_err(|error| {
            format!(
                "runtime file {} uses writeMode merge for JSON, but existing content is invalid JSON: {error}",
                file.path
            )
        })?;
    if !existing_json.is_object() {
        return Err(format!(
            "runtime file {} uses writeMode merge for JSON, but existing content is not a JSON object",
            file.path
        ));
    }
    merge_json_value(&mut existing_json, &generated_json, None);
    serde_json::to_string_pretty(&existing_json)
        .map(ensure_trailing_newline)
        .map(Some)
        .map_err(|error| format!("failed to serialize merged JSON for {}: {error}", file.path))
}

fn merge_json_value(existing: &mut Value, generated: &Value, parent_key: Option<&str>) {
    match (existing, generated) {
        (Value::Object(existing_object), Value::Object(generated_object)) => {
            for (key, generated_value) in generated_object {
                if is_mcp_servers_key(parent_key) {
                    existing_object.insert(key.clone(), generated_value.clone());
                    continue;
                }

                match existing_object.get_mut(key) {
                    Some(existing_value) => {
                        if key == "extensions" {
                            merge_json_extensions(existing_value, generated_value);
                            continue;
                        }
                        merge_json_value(existing_value, generated_value, Some(key));
                    }
                    None => {
                        existing_object.insert(key.clone(), generated_value.clone());
                    }
                }
            }
        }
        (existing_value, generated_value) => {
            *existing_value = generated_value.clone();
        }
    }
}

fn merge_json_extensions(existing: &mut Value, generated: &Value) {
    let (Some(existing_array), Some(generated_array)) =
        (existing.as_array_mut(), generated.as_array())
    else {
        *existing = generated.clone();
        return;
    };

    for generated_item in generated_array {
        if !existing_array
            .iter()
            .any(|existing_item| existing_item == generated_item)
        {
            existing_array.push(generated_item.clone());
        }
    }
}

fn is_mcp_servers_key(key: Option<&str>) -> bool {
    matches!(key, Some("mcp" | "mcpServers" | "mcp_servers"))
}

fn merge_managed_block(existing_content: &str, replacement_content: &str) -> String {
    if let Some(start_index) = existing_content.find(MANAGED_BLOCK_START_MARKER) {
        let search_start = start_index + MANAGED_BLOCK_START_MARKER.len();
        if let Some(relative_end_index) =
            existing_content[search_start..].find(MANAGED_BLOCK_END_MARKER)
        {
            let end_index = search_start + relative_end_index + MANAGED_BLOCK_END_MARKER.len();
            let mut merged = String::new();
            merged.push_str(&existing_content[..start_index]);
            merged.push_str(trim_trailing_newlines(replacement_content));
            merged.push_str(&existing_content[end_index..]);
            return ensure_trailing_newline(merged);
        }
    }

    let mut merged = ensure_trailing_newline(existing_content.to_owned());
    if !merged.ends_with("\n\n") {
        merged.push('\n');
    }
    merged.push_str(trim_trailing_newlines(replacement_content));
    merged.push('\n');
    merged
}

fn looks_like_toml(path: &str, content: &str) -> bool {
    path.ends_with(".toml")
        || split_lines_with_endings(content)
            .iter()
            .any(|line| toml_section_name(line).is_some())
}

fn merge_toml_file(existing_content: &str, generated_content: &str) -> String {
    let mut merged = existing_content.to_owned();
    for line in generated_toml_root_key_lines(generated_content) {
        if let Some(key) = toml_key_name(&line) {
            merged = ensure_toml_root_key(&merged, key, trim_trailing_newlines(&line));
        }
    }

    for section_name in generated_toml_section_names(generated_content) {
        let Some(section) = extract_toml_section(generated_content, &section_name) else {
            continue;
        };
        if is_mcp_server_section(&section_name) {
            merged = replace_or_append_toml_section(&merged, &section_name, &section);
            continue;
        }

        let section_lines = generated_toml_section_key_lines(&section);
        if section_lines.is_empty() {
            merged = replace_or_append_toml_section(&merged, &section_name, &section);
            continue;
        }

        for line in section_lines {
            if let Some(key) = toml_key_name(&line) {
                merged = ensure_toml_section_key(
                    &merged,
                    &section_name,
                    key,
                    trim_trailing_newlines(&line),
                );
            }
        }
    }

    ensure_trailing_newline(merged)
}

fn generated_toml_root_key_lines(content: &str) -> Vec<String> {
    split_lines_with_endings(content)
        .into_iter()
        .take_while(|line| toml_section_name(line).is_none())
        .filter(|line| toml_key_name(line).is_some())
        .collect()
}

fn generated_toml_section_names(content: &str) -> Vec<String> {
    let mut section_names = Vec::new();
    for line in split_lines_with_endings(content) {
        let Some(section_name) = toml_section_name(&line) else {
            continue;
        };
        if !section_names
            .iter()
            .any(|existing: &String| existing == section_name)
        {
            section_names.push(section_name.to_owned());
        }
    }

    section_names
}

fn generated_toml_section_key_lines(section: &str) -> Vec<String> {
    split_lines_with_endings(section)
        .into_iter()
        .filter(|line| toml_key_name(line).is_some())
        .collect()
}

fn is_mcp_server_section(section_name: &str) -> bool {
    section_name.starts_with("mcp_servers.") || section_name.starts_with("mcpServers.")
}

fn extract_toml_section(content: &str, section_name: &str) -> Option<String> {
    let lines = split_lines_with_endings(content);
    let start_index = lines
        .iter()
        .position(|line| toml_section_name(line) == Some(section_name))?;
    let end_index = lines[start_index + 1..]
        .iter()
        .position(|line| toml_section_name(line).is_some())
        .map(|offset| start_index + 1 + offset)
        .unwrap_or(lines.len());

    Some(ensure_trailing_newline(
        lines[start_index..end_index].concat(),
    ))
}

fn ensure_toml_section_key(content: &str, section_name: &str, key: &str, line: &str) -> String {
    let mut lines = split_lines_with_endings(content);
    let Some(start_index) = lines
        .iter()
        .position(|candidate| toml_section_name(candidate) == Some(section_name))
    else {
        let mut output = ensure_trailing_newline(content.to_owned());
        if !output.ends_with("\n\n") {
            output.push('\n');
        }
        output.push('[');
        output.push_str(section_name);
        output.push_str("]\n");
        output.push_str(line);
        output.push('\n');
        return output;
    };

    let end_index = lines[start_index + 1..]
        .iter()
        .position(|candidate| toml_section_name(candidate).is_some())
        .map(|offset| start_index + 1 + offset)
        .unwrap_or(lines.len());

    if let Some(relative_key_index) = lines[start_index + 1..end_index]
        .iter()
        .position(|candidate| toml_key_name(candidate) == Some(key))
    {
        lines[start_index + 1 + relative_key_index] = format!("{line}\n");
        return lines.concat();
    }

    lines.insert(end_index, format!("{line}\n"));
    lines.concat()
}

fn ensure_toml_root_key(content: &str, key: &str, line: &str) -> String {
    let mut lines = split_lines_with_endings(content);
    let first_section_index = lines
        .iter()
        .position(|candidate| toml_section_name(candidate).is_some())
        .unwrap_or(lines.len());

    if let Some(existing_key_index) = lines[..first_section_index]
        .iter()
        .position(|candidate| toml_key_name(candidate) == Some(key))
    {
        lines[existing_key_index] = format!("{line}\n");
        return lines.concat();
    }

    lines.insert(first_section_index, format!("{line}\n"));
    lines.concat()
}

fn replace_or_append_toml_section(content: &str, section_name: &str, replacement: &str) -> String {
    let mut lines = split_lines_with_endings(content);
    let Some(start_index) = lines
        .iter()
        .position(|candidate| toml_section_name(candidate) == Some(section_name))
    else {
        let mut output = ensure_trailing_newline(content.to_owned());
        if !output.ends_with("\n\n") {
            output.push('\n');
        }
        output.push_str(trim_trailing_newlines(replacement));
        output.push('\n');
        return output;
    };

    let end_index = lines[start_index + 1..]
        .iter()
        .position(|candidate| toml_section_name(candidate).is_some())
        .map(|offset| start_index + 1 + offset)
        .unwrap_or(lines.len());

    lines.splice(
        start_index..end_index,
        split_lines_with_endings(replacement),
    );
    lines.concat()
}

fn split_lines_with_endings(content: &str) -> Vec<String> {
    content.lines().map(|line| format!("{line}\n")).collect()
}

fn toml_section_name(line: &str) -> Option<&str> {
    let trimmed = line.trim();
    if !trimmed.starts_with('[') || !trimmed.ends_with(']') || trimmed.starts_with("[[") {
        return None;
    }

    Some(trimmed.trim_start_matches('[').trim_end_matches(']').trim())
}

fn toml_key_name(line: &str) -> Option<&str> {
    let trimmed = line.trim_start();
    if trimmed.starts_with('#') || trimmed.starts_with('[') {
        return None;
    }

    let (key, _) = trimmed.split_once('=')?;
    Some(key.trim())
}

fn trim_trailing_newlines(content: &str) -> &str {
    content.trim_end_matches(['\r', '\n'])
}

fn ensure_trailing_newline(mut content: String) -> String {
    if !content.ends_with('\n') {
        content.push('\n');
    }

    content
}
