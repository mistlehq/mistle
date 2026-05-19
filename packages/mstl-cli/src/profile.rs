use std::io::{self, Write};

use mstl_core::client::{ListSandboxProfilesResponse, SandboxProfile, SandboxProfileStatus};

use crate::config::mistle_client;
use crate::error::CliError;

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

fn profile_status_label(status: &SandboxProfileStatus) -> &'static str {
    match status {
        SandboxProfileStatus::Active => "active",
        SandboxProfileStatus::Inactive => "inactive",
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
    use mstl_core::client::{ListSandboxProfilesResponse, SandboxProfile, SandboxProfileStatus};

    use crate::profile::{render_sandbox_profile, render_sandbox_profiles};

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
}
