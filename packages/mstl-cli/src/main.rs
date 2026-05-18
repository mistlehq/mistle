use bpaf::{OptionParser, Parser, construct, positional, pure};
use mstl_core::auth::API_KEY_ENV_VAR;
use mstl_core::client::{
    CurrentActor, CurrentActorAuthentication, ListSandboxProfilesResponse, MistleClient,
    MistleClientConfig, MistleClientError, SandboxProfile, SandboxProfileStatus,
};
use std::env::{self, VarError};
use std::fmt;
use std::io::{self, Write};

const CONTROL_PLANE_API_PUBLIC_URL_ENV_VAR: &str = "MISTLE_SERVICES_CONTROL_PLANE_API_PUBLIC_URL";

fn main() {
    let command = options().run();
    let mut stdout = io::stdout();
    let mut stderr = io::stderr();
    let exit_code = run(command, &mut stdout, &mut stderr);
    std::process::exit(exit_code);
}

#[derive(Debug, Clone)]
enum CliCommand {
    Whoami,
    ProfileList,
    ProfileGet { profile_id: String },
}

#[derive(Debug)]
enum CliError {
    MissingEnvironmentVariable {
        name: &'static str,
    },
    BlankEnvironmentVariable {
        name: &'static str,
    },
    NonUnicodeEnvironmentVariable {
        name: &'static str,
    },
    Client {
        action: &'static str,
        source: MistleClientError,
    },
}

impl fmt::Display for CliError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::MissingEnvironmentVariable { name } => {
                write!(formatter, "Missing required environment variable: {name}")
            }
            Self::BlankEnvironmentVariable { name } => write!(formatter, "{name} cannot be blank"),
            Self::NonUnicodeEnvironmentVariable { name } => {
                write!(formatter, "{name} must be valid Unicode")
            }
            Self::Client { action, source } => {
                write!(formatter, "failed to {action}: {source}")
            }
        }
    }
}

impl std::error::Error for CliError {}

fn options() -> OptionParser<CliCommand> {
    let whoami = pure(CliCommand::Whoami)
        .to_options()
        .descr("Print the current Mistle identity")
        .command("whoami");

    let profile_list = pure(CliCommand::ProfileList)
        .to_options()
        .descr("List sandbox profiles")
        .command("list");

    let profile_id = positional::<String>("profile-id")
        .help("Sandbox profile id")
        .guard(
            |value| !value.trim().is_empty(),
            "profile id cannot be blank",
        );

    let profile_get = profile_id
        .map(|profile_id| CliCommand::ProfileGet { profile_id })
        .to_options()
        .descr("Get a sandbox profile")
        .command("get");

    let profile = construct!([profile_list, profile_get])
        .to_options()
        .descr("Manage sandbox profiles")
        .command("profile");

    construct!([whoami, profile])
        .to_options()
        .descr("Mistle command line interface")
        .version(env!("CARGO_PKG_VERSION"))
}

fn run<W, E>(command: CliCommand, stdout: &mut W, stderr: &mut E) -> i32
where
    W: Write,
    E: Write,
{
    match command {
        CliCommand::Whoami => match current_actor() {
            Ok(actor) => match write_current_actor(stdout, &actor) {
                Ok(()) => 0,
                Err(error) => {
                    let _ = writeln!(stderr, "failed to write current Mistle identity: {error}");
                    1
                }
            },
            Err(error) => {
                let _ = writeln!(stderr, "{error}");
                1
            }
        },
        CliCommand::ProfileList => match list_sandbox_profiles() {
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
        },
        CliCommand::ProfileGet { profile_id } => match get_sandbox_profile(&profile_id) {
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
        },
    }
}

fn current_actor() -> Result<CurrentActor, CliError> {
    mistle_client()?
        .current_actor()
        .map_err(|source| CliError::Client {
            action: "get current Mistle identity",
            source,
        })
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

fn mistle_client() -> Result<MistleClient, CliError> {
    let api_key = required_env_var(API_KEY_ENV_VAR)?;
    let base_url = required_env_var(CONTROL_PLANE_API_PUBLIC_URL_ENV_VAR)?;

    MistleClient::new(MistleClientConfig { base_url, api_key }).map_err(|source| CliError::Client {
        action: "configure Mistle client",
        source,
    })
}

fn required_env_var(name: &'static str) -> Result<String, CliError> {
    match env::var(name) {
        Ok(value) if value.trim().is_empty() => Err(CliError::BlankEnvironmentVariable { name }),
        Ok(value) => Ok(value),
        Err(VarError::NotPresent) => Err(CliError::MissingEnvironmentVariable { name }),
        Err(VarError::NotUnicode(_)) => Err(CliError::NonUnicodeEnvironmentVariable { name }),
    }
}

fn write_current_actor<W>(stdout: &mut W, actor: &CurrentActor) -> io::Result<()>
where
    W: Write,
{
    match &actor.authentication {
        CurrentActorAuthentication::ApiKey { api_key } => {
            writeln!(stdout, "api key: {} ({})", api_key.name, api_key.id)?;
        }
    }

    writeln!(stdout, "organization: {}", actor.organization.id)
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

    use crate::render_sandbox_profiles;

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
            crate::render_sandbox_profile(&profile),
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
