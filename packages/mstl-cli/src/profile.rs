use std::fs;
use std::io::{self, Write};
use std::path::Path;

use mstl_core::client::{
    ListSandboxProfileVersionsResponse, ListSandboxProfilesResponse, SandboxProfile,
    SandboxProfileStatus, SandboxProfileVersion, SandboxProfileVersionAgentRuntimeId,
    SandboxProfileVersionDefaultPersistenceMode, SandboxProfileVersionState,
    UpdateSandboxProfileVersionDraftRequest, UpdateSandboxProfileVersionDraftResponse,
};

use crate::config::mistle_client;
use crate::error::CliError;
use crate::format::{format_bool, format_optional_value};

pub(crate) fn run_list<W, E>(stdout: &mut W, stderr: &mut E) -> i32
where
    W: Write,
    E: Write,
{
    match list_sandbox_profiles() {
        Ok(profiles) => match write_sandbox_profiles(stdout, &profiles) {
            Ok(()) => 0,
            Err(error) => {
                let _ = writeln!(stderr, "failed to write sandbox profiles: {error}");
                1
            }
        },
        Err(error) => {
            let _ = writeln!(stderr, "{error}");
            1
        }
    }
}

pub(crate) fn run_get<W, E>(profile_id: &str, stdout: &mut W, stderr: &mut E) -> i32
where
    W: Write,
    E: Write,
{
    match get_sandbox_profile(profile_id) {
        Ok(profile) => match write_sandbox_profile(stdout, &profile) {
            Ok(()) => 0,
            Err(error) => {
                let _ = writeln!(stderr, "failed to write sandbox profile: {error}");
                1
            }
        },
        Err(error) => {
            let _ = writeln!(stderr, "{error}");
            1
        }
    }
}

pub(crate) fn run_version_list<W, E>(profile_id: &str, stdout: &mut W, stderr: &mut E) -> i32
where
    W: Write,
    E: Write,
{
    match list_sandbox_profile_versions(profile_id) {
        Ok(versions) => match write_sandbox_profile_versions(stdout, &versions) {
            Ok(()) => 0,
            Err(error) => {
                let _ = writeln!(stderr, "failed to write sandbox profile versions: {error}");
                1
            }
        },
        Err(error) => {
            let _ = writeln!(stderr, "{error}");
            1
        }
    }
}

pub(crate) fn run_version_setup_script_set<W, E>(
    profile_id: &str,
    version: u32,
    file: &Path,
    stdout: &mut W,
    stderr: &mut E,
) -> i32
where
    W: Write,
    E: Write,
{
    match set_sandbox_profile_version_setup_script(profile_id, version, file) {
        Ok(updated_draft) => {
            match write_updated_sandbox_profile_version_setup_script(stdout, &updated_draft) {
                Ok(()) => 0,
                Err(error) => {
                    let _ = writeln!(
                        stderr,
                        "failed to write sandbox profile version setup script: {error}"
                    );
                    1
                }
            }
        }
        Err(error) => {
            let _ = writeln!(stderr, "{error}");
            1
        }
    }
}

fn list_sandbox_profiles() -> Result<ListSandboxProfilesResponse, CliError> {
    mistle_client()?
        .list_sandbox_profiles()
        .map_err(|source| CliError::Client {
            action: "list sandbox profiles",
            source,
        })
}

fn get_sandbox_profile(profile_id: &str) -> Result<SandboxProfile, CliError> {
    mistle_client()?
        .get_sandbox_profile(profile_id)
        .map_err(|source| CliError::Client {
            action: "get sandbox profile",
            source,
        })
}

fn list_sandbox_profile_versions(
    profile_id: &str,
) -> Result<ListSandboxProfileVersionsResponse, CliError> {
    mistle_client()?
        .list_sandbox_profile_versions(profile_id)
        .map_err(|source| CliError::Client {
            action: "list sandbox profile versions",
            source,
        })
}

fn set_sandbox_profile_version_setup_script(
    profile_id: &str,
    version: u32,
    file: &Path,
) -> Result<UpdateSandboxProfileVersionDraftResponse, CliError> {
    let setup_script = read_setup_script_file(file)?;

    mistle_client()?
        .update_sandbox_profile_version_draft(
            profile_id,
            version,
            UpdateSandboxProfileVersionDraftRequest {
                setup_script: Some(Some(&setup_script)),
            },
        )
        .map_err(|source| CliError::Client {
            action: "update sandbox profile version setup script",
            source,
        })
}

fn read_setup_script_file(file: &Path) -> Result<String, CliError> {
    let setup_script = fs::read_to_string(file).map_err(|source| CliError::ReadFile {
        path: file.display().to_string(),
        source,
    })?;

    if setup_script.is_empty() {
        return Err(CliError::EmptyFile {
            path: file.display().to_string(),
        });
    }

    Ok(setup_script)
}

fn write_sandbox_profiles<W>(
    stdout: &mut W,
    response: &ListSandboxProfilesResponse,
) -> io::Result<()>
where
    W: Write,
{
    write!(stdout, "{}", render_sandbox_profiles(response))
}

fn write_sandbox_profile<W>(stdout: &mut W, profile: &SandboxProfile) -> io::Result<()>
where
    W: Write,
{
    write!(stdout, "{}", render_sandbox_profile(profile))
}

fn write_sandbox_profile_versions<W>(
    stdout: &mut W,
    response: &ListSandboxProfileVersionsResponse,
) -> io::Result<()>
where
    W: Write,
{
    write!(stdout, "{}", render_sandbox_profile_versions(response))
}

fn write_updated_sandbox_profile_version_setup_script<W>(
    stdout: &mut W,
    response: &UpdateSandboxProfileVersionDraftResponse,
) -> io::Result<()>
where
    W: Write,
{
    write!(
        stdout,
        "{}",
        render_updated_sandbox_profile_version_setup_script(response)
    )
}

fn render_sandbox_profile(profile: &SandboxProfile) -> String {
    format!(
        "Profile\nID: {}\nName: {}\nStatus: {}\nActive version: {}\nCreated: {}\nUpdated: {}\n",
        profile.id,
        profile.display_name,
        profile_status_label(&profile.status),
        format_active_version(profile.active_version),
        profile.created_at,
        profile.updated_at,
    )
}

fn render_sandbox_profiles(response: &ListSandboxProfilesResponse) -> String {
    if response.items.is_empty() {
        return "No profiles found.\n".to_owned();
    }

    let rows: Vec<SandboxProfileRow> = response
        .items
        .iter()
        .map(SandboxProfileRow::from_profile)
        .collect();
    let widths = SandboxProfileTableWidths::from_rows(&rows);
    let mut output = String::new();

    output.push_str(&format!(
        "{:<id_width$}  {:<name_width$}  {:<active_version_width$}  {:<status_width$}  {}\n",
        "ID",
        "NAME",
        "ACTIVE VERSION",
        "STATUS",
        "UPDATED",
        id_width = widths.id,
        name_width = widths.name,
        active_version_width = widths.active_version,
        status_width = widths.status,
    ));

    for row in rows {
        output.push_str(&format!(
            "{:<id_width$}  {:<name_width$}  {:<active_version_width$}  {:<status_width$}  {}\n",
            row.id,
            row.name,
            row.active_version,
            row.status,
            row.updated,
            id_width = widths.id,
            name_width = widths.name,
            active_version_width = widths.active_version,
            status_width = widths.status,
        ));
    }

    output
}

fn render_sandbox_profile_versions(response: &ListSandboxProfileVersionsResponse) -> String {
    if response.versions.is_empty() {
        return "No profile versions found.\n".to_owned();
    }

    let rows: Vec<SandboxProfileVersionRow> = response
        .versions
        .iter()
        .map(SandboxProfileVersionRow::from_version)
        .collect();
    let widths = SandboxProfileVersionTableWidths::from_rows(&rows);
    let mut output = String::new();

    output.push_str(&format!(
        "{:<version_width$}  {:<state_width$}  {:<active_width$}  {:<usable_width$}  {:<runtime_width$}  {:<persistence_width$}  {:<provider_width$}  {}\n",
        "VERSION",
        "STATE",
        "ACTIVE",
        "USABLE",
        "RUNTIME",
        "PERSISTENCE",
        "PROVIDER",
        "CONNECTION",
        version_width = widths.version,
        state_width = widths.state,
        active_width = widths.active,
        usable_width = widths.usable,
        runtime_width = widths.runtime,
        persistence_width = widths.persistence,
        provider_width = widths.provider,
    ));

    for row in rows {
        output.push_str(&format!(
            "{:<version_width$}  {:<state_width$}  {:<active_width$}  {:<usable_width$}  {:<runtime_width$}  {:<persistence_width$}  {:<provider_width$}  {}\n",
            row.version,
            row.state,
            row.active,
            row.usable,
            row.runtime,
            row.persistence,
            row.provider,
            row.connection,
            version_width = widths.version,
            state_width = widths.state,
            active_width = widths.active,
            usable_width = widths.usable,
            runtime_width = widths.runtime,
            persistence_width = widths.persistence,
            provider_width = widths.provider,
        ));
    }

    output
}

fn render_updated_sandbox_profile_version_setup_script(
    response: &UpdateSandboxProfileVersionDraftResponse,
) -> String {
    format!(
        "Updated setup script\nProfile: {}\nVersion: {}\n",
        response.sandbox_profile_id, response.version,
    )
}

struct SandboxProfileRow {
    id: String,
    name: String,
    active_version: String,
    status: &'static str,
    updated: String,
}

impl SandboxProfileRow {
    fn from_profile(profile: &SandboxProfile) -> Self {
        Self {
            id: profile.id.clone(),
            name: profile.display_name.clone(),
            active_version: format_active_version(profile.active_version),
            status: profile_status_label(&profile.status),
            updated: profile.updated_at.clone(),
        }
    }
}

struct SandboxProfileTableWidths {
    id: usize,
    name: usize,
    active_version: usize,
    status: usize,
}

impl SandboxProfileTableWidths {
    fn from_rows(rows: &[SandboxProfileRow]) -> Self {
        let mut widths = Self {
            id: "ID".len(),
            name: "NAME".len(),
            active_version: "ACTIVE VERSION".len(),
            status: "STATUS".len(),
        };

        for row in rows {
            widths.id = widths.id.max(row.id.len());
            widths.name = widths.name.max(row.name.len());
            widths.active_version = widths.active_version.max(row.active_version.len());
            widths.status = widths.status.max(row.status.len());
        }

        widths
    }
}

struct SandboxProfileVersionRow {
    version: String,
    state: &'static str,
    active: &'static str,
    usable: &'static str,
    runtime: &'static str,
    persistence: &'static str,
    provider: String,
    connection: String,
}

impl SandboxProfileVersionRow {
    fn from_version(version: &SandboxProfileVersion) -> Self {
        Self {
            version: version.version.to_string(),
            state: profile_version_state_label(&version.state),
            active: format_bool(version.is_active),
            usable: format_bool(version.usable),
            runtime: profile_version_agent_runtime_label(&version.agent_runtime_id),
            persistence: profile_version_persistence_mode_label(&version.default_persistence_mode),
            provider: format_optional_value(version.sandbox_provider.as_deref()).to_owned(),
            connection: format_optional_value(version.sandbox_connection_id.as_deref()).to_owned(),
        }
    }
}

struct SandboxProfileVersionTableWidths {
    version: usize,
    state: usize,
    active: usize,
    usable: usize,
    runtime: usize,
    persistence: usize,
    provider: usize,
}

impl SandboxProfileVersionTableWidths {
    fn from_rows(rows: &[SandboxProfileVersionRow]) -> Self {
        let mut widths = Self {
            version: "VERSION".len(),
            state: "STATE".len(),
            active: "ACTIVE".len(),
            usable: "USABLE".len(),
            runtime: "RUNTIME".len(),
            persistence: "PERSISTENCE".len(),
            provider: "PROVIDER".len(),
        };

        for row in rows {
            widths.version = widths.version.max(row.version.len());
            widths.state = widths.state.max(row.state.len());
            widths.active = widths.active.max(row.active.len());
            widths.usable = widths.usable.max(row.usable.len());
            widths.runtime = widths.runtime.max(row.runtime.len());
            widths.persistence = widths.persistence.max(row.persistence.len());
            widths.provider = widths.provider.max(row.provider.len());
        }

        widths
    }
}

fn profile_status_label(status: &SandboxProfileStatus) -> &'static str {
    match status {
        SandboxProfileStatus::Active => "active",
        SandboxProfileStatus::Inactive => "inactive",
    }
}

fn profile_version_state_label(state: &SandboxProfileVersionState) -> &'static str {
    match state {
        SandboxProfileVersionState::Draft => "draft",
        SandboxProfileVersionState::Published => "published",
    }
}

fn profile_version_agent_runtime_label(
    agent_runtime_id: &SandboxProfileVersionAgentRuntimeId,
) -> &'static str {
    match agent_runtime_id {
        SandboxProfileVersionAgentRuntimeId::Codex => "codex",
        SandboxProfileVersionAgentRuntimeId::Opencode => "opencode",
    }
}

fn profile_version_persistence_mode_label(
    persistence_mode: &SandboxProfileVersionDefaultPersistenceMode,
) -> &'static str {
    match persistence_mode {
        SandboxProfileVersionDefaultPersistenceMode::Ephemeral => "ephemeral",
        SandboxProfileVersionDefaultPersistenceMode::Persistent => "persistent",
    }
}

fn format_active_version(active_version: Option<u32>) -> String {
    match active_version {
        Some(active_version) => active_version.to_string(),
        None => "-".to_owned(),
    }
}

#[cfg(test)]
mod tests {
    use mstl_core::client::{
        ListSandboxProfileVersionsResponse, ListSandboxProfilesResponse, SandboxProfile,
        SandboxProfileStatus, SandboxProfileVersion, SandboxProfileVersionAgentRuntimeId,
        SandboxProfileVersionDefaultPersistenceMode, SandboxProfileVersionState,
        UpdateSandboxProfileVersionDraftResponse,
    };

    use crate::profile::{
        render_sandbox_profile, render_sandbox_profile_versions, render_sandbox_profiles,
        render_updated_sandbox_profile_version_setup_script,
    };

    #[test]
    fn renders_empty_profile_list() {
        let response = ListSandboxProfilesResponse {
            total_results: 0,
            items: Vec::new(),
            next_page: None,
            previous_page: None,
        };

        assert_eq!(render_sandbox_profiles(&response), "No profiles found.\n");
    }

    #[test]
    fn renders_profile_list_table() {
        let response = ListSandboxProfilesResponse {
            total_results: 2,
            items: vec![
                SandboxProfile {
                    id: "sbp_python".to_owned(),
                    display_name: "Python Dev".to_owned(),
                    active_version: Some(3),
                    status: SandboxProfileStatus::Active,
                    created_at: "2026-05-12T01:02:03.000Z".to_owned(),
                    updated_at: "2026-05-18T01:02:03.000Z".to_owned(),
                },
                SandboxProfile {
                    id: "sbp_node".to_owned(),
                    display_name: "Node".to_owned(),
                    active_version: None,
                    status: SandboxProfileStatus::Inactive,
                    created_at: "2026-05-11T01:02:03.000Z".to_owned(),
                    updated_at: "2026-05-17T01:02:03.000Z".to_owned(),
                },
            ],
            next_page: None,
            previous_page: None,
        };

        assert_eq!(
            render_sandbox_profiles(&response),
            concat!(
                "ID          NAME        ACTIVE VERSION  STATUS    UPDATED\n",
                "sbp_python  Python Dev  3               active    2026-05-18T01:02:03.000Z\n",
                "sbp_node    Node        -               inactive  2026-05-17T01:02:03.000Z\n",
            ),
        );
    }

    #[test]
    fn renders_profile_details() {
        let profile = SandboxProfile {
            id: "sbp_python".to_owned(),
            display_name: "Python Dev".to_owned(),
            active_version: Some(3),
            status: SandboxProfileStatus::Active,
            created_at: "2026-05-12T01:02:03.000Z".to_owned(),
            updated_at: "2026-05-18T01:02:03.000Z".to_owned(),
        };

        assert_eq!(
            render_sandbox_profile(&profile),
            concat!(
                "Profile\n",
                "ID: sbp_python\n",
                "Name: Python Dev\n",
                "Status: active\n",
                "Active version: 3\n",
                "Created: 2026-05-12T01:02:03.000Z\n",
                "Updated: 2026-05-18T01:02:03.000Z\n",
            ),
        );
    }

    #[test]
    fn renders_empty_profile_version_list() {
        let response = ListSandboxProfileVersionsResponse {
            versions: Vec::new(),
        };

        assert_eq!(
            render_sandbox_profile_versions(&response),
            "No profile versions found.\n"
        );
    }

    #[test]
    fn renders_profile_version_list_table() {
        let response = ListSandboxProfileVersionsResponse {
            versions: vec![
                SandboxProfileVersion {
                    sandbox_profile_id: "sbp_python".to_owned(),
                    version: 3,
                    state: SandboxProfileVersionState::Draft,
                    is_active: false,
                    usable: false,
                    agent_runtime_id: SandboxProfileVersionAgentRuntimeId::Codex,
                    default_persistence_mode:
                        SandboxProfileVersionDefaultPersistenceMode::Persistent,
                    sandbox_provider: Some("daytona".to_owned()),
                    sandbox_connection_id: Some("icn_daytona".to_owned()),
                },
                SandboxProfileVersion {
                    sandbox_profile_id: "sbp_python".to_owned(),
                    version: 2,
                    state: SandboxProfileVersionState::Published,
                    is_active: true,
                    usable: true,
                    agent_runtime_id: SandboxProfileVersionAgentRuntimeId::Opencode,
                    default_persistence_mode:
                        SandboxProfileVersionDefaultPersistenceMode::Ephemeral,
                    sandbox_provider: None,
                    sandbox_connection_id: None,
                },
            ],
        };

        assert_eq!(
            render_sandbox_profile_versions(&response),
            concat!(
                "VERSION  STATE      ACTIVE  USABLE  RUNTIME   PERSISTENCE  PROVIDER  CONNECTION\n",
                "3        draft      no      no      codex     persistent   daytona   icn_daytona\n",
                "2        published  yes     yes     opencode  ephemeral    -         -\n",
            ),
        );
    }

    #[test]
    fn renders_updated_setup_script_summary() {
        let response = UpdateSandboxProfileVersionDraftResponse {
            sandbox_profile_id: "sbp_python".to_owned(),
            version: 3,
            setup_script: Some("#!/usr/bin/env bash\npnpm install".to_owned()),
            default_persistence_mode: SandboxProfileVersionDefaultPersistenceMode::Persistent,
            agent_runtime_id: SandboxProfileVersionAgentRuntimeId::Codex,
            sandbox_provider: Some("daytona".to_owned()),
            sandbox_connection_id: Some("icn_daytona".to_owned()),
        };

        assert_eq!(
            render_updated_sandbox_profile_version_setup_script(&response),
            "Updated setup script\nProfile: sbp_python\nVersion: 3\n",
        );
    }
}
