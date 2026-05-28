use std::io::{self, Write};

use mstl_core::client::{
    ListSandboxInstancesRequest, ListSandboxInstancesResponse, SandboxInstance,
    SandboxInstanceListItem, SandboxInstanceSource, SandboxInstanceStartupOperationKind,
    SandboxInstanceStatus, StartSandboxProfileInstanceResponse, StartSandboxProfileInstanceStatus,
};

use crate::config::mistle_client;
use crate::error::CliError;
use crate::format::{
    format_agent_runtime_id, format_bool, format_optional_value, format_started_by,
};

pub(crate) fn run_create<W, E>(
    profile_id: &str,
    version: Option<u32>,
    stdout: &mut W,
    stderr: &mut E,
) -> i32
where
    W: Write,
    E: Write,
{
    match create_sandbox(profile_id, version) {
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
    }
}

pub(crate) fn run_list<W, E>(
    limit: Option<u32>,
    after: Option<String>,
    stdout: &mut W,
    stderr: &mut E,
) -> i32
where
    W: Write,
    E: Write,
{
    match list_sandboxes(limit, after) {
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
    }
}

pub(crate) fn run_get<W, E>(sandbox_id: &str, stdout: &mut W, stderr: &mut E) -> i32
where
    W: Write,
    E: Write,
{
    match get_sandbox(sandbox_id) {
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
    }
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

fn list_sandboxes(
    limit: Option<u32>,
    after: Option<String>,
) -> Result<ListSandboxInstancesResponse, CliError> {
    mistle_client()?
        .list_sandbox_instances(ListSandboxInstancesRequest { limit, after })
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

    if let Some(next_page) = &response.next_page
        && let Some(after) = &next_page.after
    {
        output.push_str(&format!(
            "\nNext page: mistle sandbox list --limit {} --after {}\n",
            next_page.limit, after,
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
        SandboxInstanceStatus::Started => "started",
        SandboxInstanceStatus::Initializing => "initializing",
        SandboxInstanceStatus::Running => "running",
        SandboxInstanceStatus::Reconnecting => "reconnecting",
        SandboxInstanceStatus::Stopping => "stopping",
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

#[cfg(test)]
mod tests {
    use mstl_core::client::{
        KeysetPage, ListSandboxInstancesResponse, SandboxInstance, SandboxInstanceAgentRuntimeId,
        SandboxInstanceListItem, SandboxInstanceRuntimeContext, SandboxInstanceSource,
        SandboxInstanceStartedBy, SandboxInstanceStartupOperation,
        SandboxInstanceStartupOperationKind, SandboxInstanceStatus,
        SandboxInstanceTriggerConversation, StartSandboxProfileInstanceResponse,
        StartSandboxProfileInstanceStatus,
    };

    use crate::sandbox::{
        render_created_sandbox, render_sandbox, render_sandboxes, sandbox_status_label,
    };

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
    fn renders_expanded_sandbox_status_labels() {
        assert_eq!(
            sandbox_status_label(&SandboxInstanceStatus::Started),
            "started"
        );
        assert_eq!(
            sandbox_status_label(&SandboxInstanceStatus::Initializing),
            "initializing",
        );
        assert_eq!(
            sandbox_status_label(&SandboxInstanceStatus::Reconnecting),
            "reconnecting",
        );
        assert_eq!(
            sandbox_status_label(&SandboxInstanceStatus::Stopping),
            "stopping"
        );
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
            next_page: Some(KeysetPage {
                limit: 2,
                after: Some("cursor_02".to_owned()),
                before: None,
            }),
            previous_page: None,
        };

        assert_eq!(
            render_sandboxes(&response),
            concat!(
                "ID          TITLE       PROFILE  VERSION  STATUS   SOURCE     STARTED BY         UPDATED\n",
                "sbi_python  Python Dev  Python   3        running  dashboard  local (apk_local)  2026-05-18T01:02:03.000Z\n",
                "sbi_failed  -           -        1        failed   schedule   usr_01             2026-05-17T01:02:03.000Z\n",
                "\n",
                "Next page: mistle sandbox list --limit 2 --after cursor_02\n",
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
