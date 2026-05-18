use bpaf::{OptionParser, Parser, construct, long, positional, pure};
use mstl_core::auth::{API_KEY_ENV_VAR, CONTROL_PLANE_API_PUBLIC_URL_ENV_VAR};
use mstl_core::client::{
    CurrentActor, CurrentActorAuthentication, ListSandboxInstancesResponse,
    ListSandboxProfilesResponse, MistleClient, MistleClientConfig, MistleClientError,
    SandboxInstance, SandboxInstanceAgentRuntimeId, SandboxInstanceListItem, SandboxInstanceSource,
    SandboxInstanceStartedBy, SandboxInstanceStartupOperationKind, SandboxInstanceStatus,
    SandboxProfile, SandboxProfileStatus, StartSandboxProfileInstanceResponse,
    StartSandboxProfileInstanceStatus,
};
use std::env::{self, VarError};
use std::fmt;
use std::io::{self, Write};

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
    ProfileGet {
        profile_id: String,
    },
    SandboxCreate {
        profile_id: String,
        version: Option<u32>,
    },
    SandboxList,
    SandboxGet {
        sandbox_id: String,
    },
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

    let profile_id = long("profile")
        .help("Sandbox profile id")
        .argument::<String>("profile-id")
        .guard(
            |value| !value.trim().is_empty(),
            "profile id cannot be blank",
        );
    let version = long("version")
        .help("Sandbox profile version")
        .argument::<u32>("version")
        .guard(|value| *value > 0, "version must be greater than zero")
        .optional();

    let sandbox_create = construct!(CliCommand::SandboxCreate {
        profile_id,
        version
    })
    .to_options()
    .descr("Create a sandbox")
    .command("create");

    let sandbox_list = pure(CliCommand::SandboxList)
        .to_options()
        .descr("List sandboxes")
        .command("list");

    let sandbox_id = positional::<String>("sandbox-id").help("Sandbox id").guard(
        |value| !value.trim().is_empty(),
        "sandbox id cannot be blank",
    );

    let sandbox_get = sandbox_id
        .map(|sandbox_id| CliCommand::SandboxGet { sandbox_id })
        .to_options()
        .descr("Get a sandbox")
        .command("get");

    let sandbox = construct!([sandbox_create, sandbox_list, sandbox_get])
        .to_options()
        .descr("Manage sandboxes")
        .command("sandbox");

    construct!([whoami, profile, sandbox])
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
        CliCommand::SandboxCreate {
            profile_id,
            version,
        } => match create_sandbox(&profile_id, version) {
            Ok(response) => match write_created_sandbox(stdout, &response) {
                Ok(()) => 0,
                Err(error) => {
                    let _ = writeln!(stderr, "failed to write created sandbox: {error}");
                    1
                }
            },
            Err(error) => {
                let _ = writeln!(stderr, "{error}");
                1
            }
        },
        CliCommand::SandboxList => match list_sandboxes() {
            Ok(sandboxes) => match write_sandboxes(stdout, &sandboxes) {
                Ok(()) => 0,
                Err(error) => {
                    let _ = writeln!(stderr, "failed to write sandboxes: {error}");
                    1
                }
            },
            Err(error) => {
                let _ = writeln!(stderr, "{error}");
                1
            }
        },
        CliCommand::SandboxGet { sandbox_id } => match get_sandbox(&sandbox_id) {
            Ok(sandbox) => match write_sandbox(stdout, &sandbox) {
                Ok(()) => 0,
                Err(error) => {
                    let _ = writeln!(stderr, "failed to write sandbox: {error}");
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

fn create_sandbox(
    profile_id: &str,
    version: Option<u32>,
) -> Result<StartSandboxProfileInstanceResponse, CliError> {
    let client = mistle_client()?;
    let response = match version {
        Some(version) => client.start_sandbox_profile_instance_version(profile_id, version),
        None => client.start_active_sandbox_profile_instance(profile_id),
    };

    response.map_err(|source| CliError::Client {
        action: "create sandbox",
        source,
    })
}

fn list_sandboxes() -> Result<ListSandboxInstancesResponse, CliError> {
    mistle_client()?
        .list_sandbox_instances()
        .map_err(|source| CliError::Client {
            action: "list sandboxes",
            source,
        })
}

fn get_sandbox(sandbox_id: &str) -> Result<SandboxInstance, CliError> {
    mistle_client()?
        .get_sandbox_instance(sandbox_id)
        .map_err(|source| CliError::Client {
            action: "get sandbox",
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

fn write_created_sandbox<W>(
    stdout: &mut W,
    response: &StartSandboxProfileInstanceResponse,
) -> io::Result<()>
where
    W: Write,
{
    write!(stdout, "{}", render_created_sandbox(response))
}

fn write_sandboxes<W>(stdout: &mut W, response: &ListSandboxInstancesResponse) -> io::Result<()>
where
    W: Write,
{
    write!(stdout, "{}", render_sandboxes(response))
}

fn write_sandbox<W>(stdout: &mut W, sandbox: &SandboxInstance) -> io::Result<()>
where
    W: Write,
{
    write!(stdout, "{}", render_sandbox(sandbox))
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

fn render_created_sandbox(response: &StartSandboxProfileInstanceResponse) -> String {
    format!(
        "Sandbox\nID: {}\nStatus: {}\nWorkflow: {}\n",
        response.sandbox_instance_id,
        start_sandbox_profile_instance_status_label(&response.status),
        response.workflow_run_id,
    )
}

fn render_sandboxes(response: &ListSandboxInstancesResponse) -> String {
    if response.items.is_empty() {
        return "No sandboxes found.\n".to_owned();
    }

    let rows: Vec<SandboxRow> = response
        .items
        .iter()
        .map(SandboxRow::from_sandbox)
        .collect();
    let widths = SandboxTableWidths::from_rows(&rows);
    let mut output = String::new();

    output.push_str(&format!(
        "{:<id_width$}  {:<title_width$}  {:<profile_width$}  {:<version_width$}  {:<status_width$}  {:<source_width$}  {:<started_by_width$}  {}\n",
        "ID",
        "TITLE",
        "PROFILE",
        "VERSION",
        "STATUS",
        "SOURCE",
        "STARTED BY",
        "UPDATED",
        id_width = widths.id,
        title_width = widths.title,
        profile_width = widths.profile,
        version_width = widths.version,
        status_width = widths.status,
        source_width = widths.source,
        started_by_width = widths.started_by,
    ));

    for row in rows {
        output.push_str(&format!(
            "{:<id_width$}  {:<title_width$}  {:<profile_width$}  {:<version_width$}  {:<status_width$}  {:<source_width$}  {:<started_by_width$}  {}\n",
            row.id,
            row.title,
            row.profile,
            row.version,
            row.status,
            row.source,
            row.started_by,
            row.updated,
            id_width = widths.id,
            title_width = widths.title,
            profile_width = widths.profile,
            version_width = widths.version,
            status_width = widths.status,
            source_width = widths.source,
            started_by_width = widths.started_by,
        ));
    }

    output
}

fn render_sandbox(sandbox: &SandboxInstance) -> String {
    let runtime_context = match &sandbox.runtime_context {
        Some(runtime_context) => format!(
            "{} / {} / {}",
            format_agent_runtime_id(&runtime_context.agent_runtime_id),
            format_optional_value(runtime_context.launch_cwd.as_deref()),
            format_optional_value(runtime_context.primary_repository_root.as_deref()),
        ),
        None => "-".to_owned(),
    };
    let trigger_conversation = match &sandbox.trigger_conversation {
        Some(trigger_conversation) => format!(
            "{} / {} / {}",
            trigger_conversation.conversation_id,
            format_optional_value(trigger_conversation.route_id.as_deref()),
            format_optional_value(trigger_conversation.provider_conversation_id.as_deref()),
        ),
        None => "-".to_owned(),
    };
    let startup_operation = match &sandbox.startup_operation {
        Some(startup_operation) => format!(
            "{} ({})",
            startup_operation.operation_id,
            startup_operation_kind_label(&startup_operation.operation_kind),
        ),
        None => "-".to_owned(),
    };

    format!(
        "Sandbox\nID: {}\nTitle: {}\nStatus: {}\nConnectable: {}\nFailure code: {}\nFailure message: {}\nRuntime context: {}\nTrigger conversation: {}\nStartup operation: {}\n",
        sandbox.id,
        format_optional_value(sandbox.title.as_deref()),
        sandbox_status_label(&sandbox.status),
        format_bool(sandbox.connectable),
        format_optional_value(sandbox.failure_code.as_deref()),
        format_optional_value(sandbox.failure_message.as_deref()),
        runtime_context,
        trigger_conversation,
        startup_operation,
    )
}

struct SandboxRow {
    id: String,
    title: String,
    profile: String,
    version: String,
    status: &'static str,
    source: &'static str,
    started_by: String,
    updated: String,
}

impl SandboxRow {
    fn from_sandbox(sandbox: &SandboxInstanceListItem) -> Self {
        Self {
            id: sandbox.id.clone(),
            title: format_optional_value(sandbox.title.as_deref()).to_owned(),
            profile: format_optional_value(sandbox.sandbox_profile_display_name.as_deref())
                .to_owned(),
            version: sandbox.sandbox_profile_version.to_string(),
            status: sandbox_status_label(&sandbox.status),
            source: sandbox_source_label(&sandbox.source),
            started_by: format_started_by(&sandbox.started_by),
            updated: sandbox.updated_at.clone(),
        }
    }
}

struct SandboxTableWidths {
    id: usize,
    title: usize,
    profile: usize,
    version: usize,
    status: usize,
    source: usize,
    started_by: usize,
}

impl SandboxTableWidths {
    fn from_rows(rows: &[SandboxRow]) -> Self {
        let mut widths = Self {
            id: "ID".len(),
            title: "TITLE".len(),
            profile: "PROFILE".len(),
            version: "VERSION".len(),
            status: "STATUS".len(),
            source: "SOURCE".len(),
            started_by: "STARTED BY".len(),
        };

        for row in rows {
            widths.id = widths.id.max(row.id.len());
            widths.title = widths.title.max(row.title.len());
            widths.profile = widths.profile.max(row.profile.len());
            widths.version = widths.version.max(row.version.len());
            widths.status = widths.status.max(row.status.len());
            widths.source = widths.source.max(row.source.len());
            widths.started_by = widths.started_by.max(row.started_by.len());
        }

        widths
    }
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

fn start_sandbox_profile_instance_status_label(
    status: &StartSandboxProfileInstanceStatus,
) -> &'static str {
    match status {
        StartSandboxProfileInstanceStatus::Accepted => "accepted",
    }
}

fn sandbox_status_label(status: &SandboxInstanceStatus) -> &'static str {
    match status {
        SandboxInstanceStatus::Pending => "pending",
        SandboxInstanceStatus::Starting => "starting",
        SandboxInstanceStatus::Running => "running",
        SandboxInstanceStatus::Stopped => "stopped",
        SandboxInstanceStatus::Failed => "failed",
    }
}

fn startup_operation_kind_label(kind: &SandboxInstanceStartupOperationKind) -> &'static str {
    match kind {
        SandboxInstanceStartupOperationKind::Start => "start",
        SandboxInstanceStartupOperationKind::Resume => "resume",
    }
}

fn sandbox_source_label(source: &SandboxInstanceSource) -> &'static str {
    match source {
        SandboxInstanceSource::Dashboard => "dashboard",
        SandboxInstanceSource::Webhook => "webhook",
        SandboxInstanceSource::Schedule => "schedule",
    }
}

fn format_started_by(started_by: &SandboxInstanceStartedBy) -> String {
    match started_by {
        SandboxInstanceStartedBy::User { id, name }
        | SandboxInstanceStartedBy::ApiKey { id, name }
        | SandboxInstanceStartedBy::System { id, name } => match name {
            Some(name) => format!("{name} ({id})"),
            None => id.clone(),
        },
    }
}

fn format_agent_runtime_id(
    agent_runtime_id: &Option<SandboxInstanceAgentRuntimeId>,
) -> &'static str {
    match agent_runtime_id {
        Some(SandboxInstanceAgentRuntimeId::Codex) => "codex",
        Some(SandboxInstanceAgentRuntimeId::Opencode) => "opencode",
        None => "-",
    }
}

fn format_active_version(active_version: Option<u32>) -> String {
    match active_version {
        Some(active_version) => active_version.to_string(),
        None => "-".to_owned(),
    }
}

fn format_bool(value: bool) -> &'static str {
    if value { "yes" } else { "no" }
}

fn format_optional_value(value: Option<&str>) -> &str {
    match value {
        Some(value) => value,
        None => "-",
    }
}

#[cfg(test)]
mod tests {
    use mstl_core::client::{
        ListSandboxInstancesResponse, ListSandboxProfilesResponse, SandboxInstance,
        SandboxInstanceAgentRuntimeId, SandboxInstanceListItem, SandboxInstanceRuntimeContext,
        SandboxInstanceSource, SandboxInstanceStartedBy, SandboxInstanceStartupOperation,
        SandboxInstanceStartupOperationKind, SandboxInstanceStatus,
        SandboxInstanceTriggerConversation, SandboxProfile, SandboxProfileStatus,
        StartSandboxProfileInstanceResponse, StartSandboxProfileInstanceStatus,
    };

    use crate::{
        render_created_sandbox, render_sandbox, render_sandbox_profiles, render_sandboxes,
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

    #[test]
    fn renders_created_sandbox_details() {
        let response = StartSandboxProfileInstanceResponse {
            status: StartSandboxProfileInstanceStatus::Accepted,
            workflow_run_id: "wfr_01".to_owned(),
            sandbox_instance_id: "sbi_01".to_owned(),
        };

        assert_eq!(
            render_created_sandbox(&response),
            concat!(
                "Sandbox\n",
                "ID: sbi_01\n",
                "Status: accepted\n",
                "Workflow: wfr_01\n",
            ),
        );
    }

    #[test]
    fn renders_empty_sandbox_list() {
        let response = ListSandboxInstancesResponse {
            total_results: 0,
            items: Vec::new(),
            next_page: None,
            previous_page: None,
        };

        assert_eq!(render_sandboxes(&response), "No sandboxes found.\n");
    }

    #[test]
    fn renders_sandbox_list_table() {
        let response = ListSandboxInstancesResponse {
            total_results: 2,
            items: vec![
                SandboxInstanceListItem {
                    id: "sbi_python".to_owned(),
                    sandbox_profile_id: "sbp_python".to_owned(),
                    title: Some("Python Dev".to_owned()),
                    sandbox_profile_display_name: Some("Python".to_owned()),
                    sandbox_profile_version: 3,
                    status: SandboxInstanceStatus::Running,
                    started_by: SandboxInstanceStartedBy::ApiKey {
                        id: "apk_local".to_owned(),
                        name: Some("local".to_owned()),
                    },
                    source: SandboxInstanceSource::Dashboard,
                    created_at: "2026-05-18T01:01:03.000Z".to_owned(),
                    updated_at: "2026-05-18T01:02:03.000Z".to_owned(),
                    failure_code: None,
                    failure_message: None,
                },
                SandboxInstanceListItem {
                    id: "sbi_failed".to_owned(),
                    sandbox_profile_id: "sbp_node".to_owned(),
                    title: None,
                    sandbox_profile_display_name: None,
                    sandbox_profile_version: 1,
                    status: SandboxInstanceStatus::Failed,
                    started_by: SandboxInstanceStartedBy::User {
                        id: "usr_01".to_owned(),
                        name: None,
                    },
                    source: SandboxInstanceSource::Schedule,
                    created_at: "2026-05-17T01:01:03.000Z".to_owned(),
                    updated_at: "2026-05-17T01:02:03.000Z".to_owned(),
                    failure_code: Some("provider_error".to_owned()),
                    failure_message: Some("Provider failed".to_owned()),
                },
            ],
            next_page: None,
            previous_page: None,
        };

        assert_eq!(
            render_sandboxes(&response),
            concat!(
                "ID          TITLE       PROFILE  VERSION  STATUS   SOURCE     STARTED BY         UPDATED\n",
                "sbi_python  Python Dev  Python   3        running  dashboard  local (apk_local)  2026-05-18T01:02:03.000Z\n",
                "sbi_failed  -           -        1        failed   schedule   usr_01             2026-05-17T01:02:03.000Z\n",
            ),
        );
    }

    #[test]
    fn renders_sandbox_details() {
        let sandbox = SandboxInstance {
            id: "sbi_01".to_owned(),
            title: Some("Python dev".to_owned()),
            status: SandboxInstanceStatus::Running,
            connectable: true,
            failure_code: None,
            failure_message: None,
            runtime_context: Some(SandboxInstanceRuntimeContext {
                agent_runtime_id: Some(SandboxInstanceAgentRuntimeId::Codex),
                launch_cwd: Some("/workspace".to_owned()),
                primary_repository_root: Some("/workspace/mistle".to_owned()),
            }),
            trigger_conversation: Some(SandboxInstanceTriggerConversation {
                conversation_id: "cnv_01".to_owned(),
                route_id: None,
                provider_conversation_id: Some("provider_01".to_owned()),
            }),
            startup_operation: Some(SandboxInstanceStartupOperation {
                operation_id: "op_01".to_owned(),
                operation_kind: SandboxInstanceStartupOperationKind::Start,
            }),
        };

        assert_eq!(
            render_sandbox(&sandbox),
            concat!(
                "Sandbox\n",
                "ID: sbi_01\n",
                "Title: Python dev\n",
                "Status: running\n",
                "Connectable: yes\n",
                "Failure code: -\n",
                "Failure message: -\n",
                "Runtime context: codex / /workspace / /workspace/mistle\n",
                "Trigger conversation: cnv_01 / - / provider_01\n",
                "Startup operation: op_01 (start)\n",
            ),
        );
    }
}
