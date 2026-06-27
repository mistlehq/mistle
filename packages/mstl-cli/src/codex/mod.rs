use std::io::Write;
use std::time::Duration;

pub(crate) mod proxy;

use mstl_core::client::{MistleClient, SandboxInstance, SandboxInstanceStatus};
use tokio::time::{Instant, sleep};

use crate::config::mistle_client;
use crate::error::CliError;

pub(crate) use proxy::CodexRunError;

use proxy::{CodexRunConfig, run_codex, validate_codex_args};

const SANDBOX_CONNECT_TIMEOUT: Duration = Duration::from_secs(5 * 60);
const SANDBOX_CONNECT_POLL_INTERVAL: Duration = Duration::from_secs(2);
const SPINNER_INTERVAL: Duration = Duration::from_millis(100);
const SPINNER_FRAMES: [&str; 4] = ["|", "/", "-", "\\"];

pub(crate) async fn run<W>(sandbox_id: &str, codex_args: Vec<String>, stderr: &mut W) -> i32
where
    W: Write,
{
    match run_codex_for_sandbox(sandbox_id, codex_args, stderr).await {
        Ok(()) => 0,
        Err(error) => {
            let _ = writeln!(stderr, "{error}");
            1
        }
    }
}

async fn run_codex_for_sandbox<W>(
    sandbox_id: &str,
    codex_args: Vec<String>,
    stderr: &mut W,
) -> Result<(), CliError>
where
    W: Write,
{
    validate_codex_args(&codex_args).map_err(|source| CliError::Codex {
        action: "validate codex arguments",
        source,
    })?;

    let client = mistle_client()?;
    wait_for_connectable_sandbox(&client, sandbox_id, stderr).await?;

    let connection_token = client
        .create_sandbox_instance_connection_token(sandbox_id)
        .map_err(|source| CliError::Client {
            action: "create sandbox connection token",
            source,
        })?;

    run_codex(CodexRunConfig {
        tunnel_url: connection_token.url,
        codex_args,
    })
    .await
    .map_err(|source| CliError::Codex {
        action: "run codex",
        source,
    })
}

async fn wait_for_connectable_sandbox<W>(
    client: &MistleClient,
    sandbox_id: &str,
    stderr: &mut W,
) -> Result<(), CliError>
where
    W: Write,
{
    let deadline = Instant::now() + SANDBOX_CONNECT_TIMEOUT;
    let mut spinner_index = 0;
    let mut spinner_rendered = false;

    loop {
        let sandbox = match client.get_sandbox_instance(sandbox_id) {
            Ok(sandbox) => sandbox,
            Err(source) => {
                clear_spinner_if_rendered(stderr, spinner_rendered);
                return Err(CliError::Client {
                    action: "get sandbox",
                    source,
                });
            }
        };

        match classify_sandbox_for_codex(&sandbox) {
            SandboxCodexReadiness::Connectable => {
                clear_spinner_if_rendered(stderr, spinner_rendered);
                return Ok(());
            }
            SandboxCodexReadiness::Failed { message } => {
                clear_spinner_if_rendered(stderr, spinner_rendered);
                return Err(CliError::SandboxFailedBeforeConnect {
                    sandbox_id: sandbox.id.clone(),
                    message: message.map(str::to_owned),
                });
            }
            SandboxCodexReadiness::Stopped { status } => {
                clear_spinner_if_rendered(stderr, spinner_rendered);
                return Err(CliError::SandboxStoppedBeforeConnect {
                    sandbox_id: sandbox.id.clone(),
                    status,
                });
            }
            SandboxCodexReadiness::Waiting { status } => {
                if Instant::now() >= deadline {
                    clear_spinner_if_rendered(stderr, spinner_rendered);
                    return Err(CliError::SandboxConnectTimeout {
                        sandbox_id: sandbox.id.clone(),
                        timeout_seconds: SANDBOX_CONNECT_TIMEOUT.as_secs(),
                    });
                }

                let wait_result =
                    wait_before_next_poll(stderr, sandbox_id, status, spinner_index, deadline)
                        .await;
                spinner_index = wait_result.next_spinner_index;
                spinner_rendered |= wait_result.rendered_spinner;
            }
        }
    }
}

async fn wait_before_next_poll<W>(
    stderr: &mut W,
    sandbox_id: &str,
    status: &'static str,
    mut spinner_index: usize,
    deadline: Instant,
) -> SandboxPollWaitResult
where
    W: Write,
{
    let poll_deadline = min_instant(Instant::now() + SANDBOX_CONNECT_POLL_INTERVAL, deadline);
    let mut rendered_spinner = false;

    while Instant::now() < poll_deadline {
        let frame = SPINNER_FRAMES[spinner_index % SPINNER_FRAMES.len()];
        let _ = write!(
            stderr,
            "\r\x1b[2K{frame} Waiting for sandbox {sandbox_id} to become connectable ({status})"
        );
        let _ = stderr.flush();
        spinner_index += 1;
        rendered_spinner = true;

        let now = Instant::now();
        let sleep_duration = if now + SPINNER_INTERVAL > poll_deadline {
            poll_deadline - now
        } else {
            SPINNER_INTERVAL
        };
        sleep(sleep_duration).await;
    }

    SandboxPollWaitResult {
        next_spinner_index: spinner_index,
        rendered_spinner,
    }
}

fn min_instant(left: Instant, right: Instant) -> Instant {
    if left <= right { left } else { right }
}

struct SandboxPollWaitResult {
    next_spinner_index: usize,
    rendered_spinner: bool,
}

fn clear_spinner_if_rendered<W>(stderr: &mut W, spinner_rendered: bool)
where
    W: Write,
{
    if spinner_rendered {
        clear_spinner(stderr);
    }
}

fn clear_spinner<W>(stderr: &mut W)
where
    W: Write,
{
    let _ = write!(stderr, "\r\x1b[2K");
    let _ = stderr.flush();
}

#[derive(Debug, PartialEq, Eq)]
enum SandboxCodexReadiness<'a> {
    Connectable,
    Waiting { status: &'static str },
    Failed { message: Option<&'a str> },
    Stopped { status: &'static str },
}

fn classify_sandbox_for_codex(sandbox: &SandboxInstance) -> SandboxCodexReadiness<'_> {
    if sandbox.connectable {
        return SandboxCodexReadiness::Connectable;
    }

    match sandbox.status {
        SandboxInstanceStatus::Failed => SandboxCodexReadiness::Failed {
            message: sandbox.failure_message.as_deref(),
        },
        SandboxInstanceStatus::Stopped => SandboxCodexReadiness::Stopped { status: "stopped" },
        ref status => SandboxCodexReadiness::Waiting {
            status: sandbox_status_label(status),
        },
    }
}

fn sandbox_status_label(status: &SandboxInstanceStatus) -> &'static str {
    match status {
        SandboxInstanceStatus::Pending => "pending",
        SandboxInstanceStatus::Starting => "starting",
        SandboxInstanceStatus::Started => "started",
        SandboxInstanceStatus::Initializing => "initializing",
        SandboxInstanceStatus::Running => "running",
        SandboxInstanceStatus::Degraded => "degraded",
        SandboxInstanceStatus::Reconnecting => "reconnecting",
        SandboxInstanceStatus::Stopping => "stopping",
        SandboxInstanceStatus::Stopped => "stopped",
        SandboxInstanceStatus::Failed => "failed",
    }
}

#[cfg(test)]
mod tests {
    use mstl_core::client::{SandboxInstance, SandboxInstanceStatus};

    use crate::codex::{SandboxCodexReadiness, classify_sandbox_for_codex};

    #[test]
    fn treats_connectable_sandbox_as_ready_even_when_status_is_degraded() {
        let sandbox = sandbox_instance(SandboxInstanceStatus::Degraded, true, None);

        assert_eq!(
            classify_sandbox_for_codex(&sandbox),
            SandboxCodexReadiness::Connectable
        );
    }

    #[test]
    fn waits_for_non_terminal_sandbox_that_is_not_connectable() {
        let sandbox = sandbox_instance(SandboxInstanceStatus::Starting, false, None);

        assert_eq!(
            classify_sandbox_for_codex(&sandbox),
            SandboxCodexReadiness::Waiting { status: "starting" }
        );
    }

    #[test]
    fn fails_when_sandbox_failed_before_becoming_connectable() {
        let sandbox = sandbox_instance(
            SandboxInstanceStatus::Failed,
            false,
            Some("provider capacity unavailable"),
        );

        assert_eq!(
            classify_sandbox_for_codex(&sandbox),
            SandboxCodexReadiness::Failed {
                message: Some("provider capacity unavailable")
            }
        );
    }

    #[test]
    fn fails_when_sandbox_stopped_before_becoming_connectable() {
        let sandbox = sandbox_instance(SandboxInstanceStatus::Stopped, false, None);

        assert_eq!(
            classify_sandbox_for_codex(&sandbox),
            SandboxCodexReadiness::Stopped { status: "stopped" }
        );
    }

    fn sandbox_instance(
        status: SandboxInstanceStatus,
        connectable: bool,
        failure_message: Option<&str>,
    ) -> SandboxInstance {
        SandboxInstance {
            id: "sbi_test".to_owned(),
            title: None,
            status,
            connectable,
            failure_code: None,
            failure_message: failure_message.map(str::to_owned),
            runtime_context: None,
            trigger_conversation: None,
            startup_operation: None,
        }
    }
}
