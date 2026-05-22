//! `sandboxd` is the long-lived sandbox supervisor daemon.
//!
//! The default entrypoint runs the daemon behind the local Unix control socket.
//! The supported lifecycle subcommands, `ready`, `init`, `resume`, and
//! `wait-init`, are thin local clients that submit requests to the running
//! daemon and exit. The `egress-proxy` subcommand runs the proxy child process.
//! The `version` subcommand prints the binary version used by release artifact
//! validation and runtime updates.

use std::fmt;
use std::io;
use std::path::{Path, PathBuf};
use std::sync::{Once, OnceLock};

use opentelemetry::trace::TracerProvider as _;
use opentelemetry_sdk::trace::SdkTracerProvider;
use tracing_subscriber::Layer as _;
use tracing_subscriber::filter::LevelFilter;
use tracing_subscriber::layer::SubscriberExt;
use tracing_subscriber::util::SubscriberInitExt;

pub mod bootstrap;
pub mod cgroups;
pub mod codex_proxy;
pub mod command;
pub mod control;
pub mod egress_proxy;
pub mod init;
pub mod keepalive;
pub mod opencode_proxy;
pub mod pi_proxy;
pub mod process;
pub mod protocol;
pub mod proxy_ca;
pub mod pty;
pub mod resume;
pub mod runtime;
pub mod sandboxd_state;
pub mod security;
pub mod sign;
pub mod startup_diagnostics;
pub mod startup_payload;
pub mod supervision;
#[doc(hidden)]
pub mod test_support;
pub mod time;
pub mod tunnel;
pub mod wait_init;

use crate::time::ThreadSleeper;
use startup_payload::StartupPayloadSource;

static TRACING_INIT: Once = Once::new();
static TRACER_PROVIDER: OnceLock<SdkTracerProvider> = OnceLock::new();

fn initialize_sandboxd_tracing() {
    TRACING_INIT.call_once(|| {
        let tracer_provider = TRACER_PROVIDER.get_or_init(SdkTracerProvider::default);
        let tracer = tracer_provider.tracer("sandboxd");
        let fmt_layer = tracing_subscriber::fmt::layer()
            .with_ansi(false)
            .with_target(false)
            .with_writer(std::io::stderr)
            .with_filter(LevelFilter::INFO);
        let otel_layer = tracing_opentelemetry::layer().with_tracer(tracer);

        let _ = tracing_subscriber::registry()
            .with(otel_layer)
            .with(fmt_layer)
            .try_init();
    });
}

/// Enumerates the top-level `sandboxd` subcommands the CLI currently supports.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum SandboxdCommand {
    Daemon,
    EgressProxy {
        config_path: PathBuf,
    },
    Ready,
    Init {
        detach: bool,
        payload_source: StartupPayloadSource,
    },
    Resume {
        payload_source: StartupPayloadSource,
    },
    Sign,
    Version,
    WaitInit,
}

/// Describes why CLI argument parsing failed before any command-specific work ran.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ParseSandboxdCommandError {
    InvalidStdinBytes(String),
    MissingEgressProxyConfigPath,
    MissingStdinBytesValue,
    UnexpectedArgument(String),
    UnknownCommand(String),
}

impl fmt::Display for ParseSandboxdCommandError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::InvalidStdinBytes(value) => {
                write!(
                    f,
                    "sandboxd --stdin-bytes must be a non-negative integer: {value}"
                )
            }
            Self::MissingStdinBytesValue => {
                write!(f, "sandboxd --stdin-bytes requires a byte count")
            }
            Self::MissingEgressProxyConfigPath => {
                write!(f, "sandboxd egress-proxy --config requires a config path")
            }
            Self::UnexpectedArgument(argument) => {
                write!(f, "unexpected sandboxd argument: {argument}")
            }
            Self::UnknownCommand(command) => write!(
                f,
                "unknown sandboxd subcommand '{command}' (expected 'ready', 'init', 'resume', 'wait-init', 'egress-proxy', or 'version')"
            ),
        }
    }
}

impl std::error::Error for ParseSandboxdCommandError {}

/// Parses `sandboxd` CLI arguments into one supported subcommand.
pub fn parse_sandboxd_command<I, S>(args: I) -> Result<SandboxdCommand, ParseSandboxdCommandError>
where
    I: IntoIterator<Item = S>,
    S: Into<String>,
{
    let mut parsed_args = args.into_iter().map(Into::into);
    let Some(command) = parsed_args.next() else {
        return Ok(SandboxdCommand::Daemon);
    };

    let command = match command.as_str() {
        "egress-proxy" => {
            let config_path = parse_egress_proxy_args(parsed_args.by_ref())?;
            return Ok(SandboxdCommand::EgressProxy { config_path });
        }
        "ready" => SandboxdCommand::Ready,
        "init" => {
            let mut detach = false;
            let mut payload_source = StartupPayloadSource::StdinUntilEof;
            while let Some(argument) = parsed_args.next() {
                match argument.as_str() {
                    "--detach" => detach = true,
                    "--stdin-bytes" => {
                        payload_source = parse_stdin_bytes(parsed_args.next())?;
                    }
                    _ => return Err(ParseSandboxdCommandError::UnexpectedArgument(argument)),
                }
            }
            return Ok(SandboxdCommand::Init {
                detach,
                payload_source,
            });
        }
        "resume" => {
            let payload_source = parse_payload_source_args(parsed_args.by_ref())?;
            return Ok(SandboxdCommand::Resume { payload_source });
        }
        "wait-init" => SandboxdCommand::WaitInit,
        "version" => SandboxdCommand::Version,
        _ => {
            return Err(ParseSandboxdCommandError::UnknownCommand(command));
        }
    };

    if let Some(unexpected_argument) = parsed_args.next() {
        return Err(ParseSandboxdCommandError::UnexpectedArgument(
            unexpected_argument,
        ));
    }

    Ok(command)
}

fn parse_egress_proxy_args<I>(parsed_args: &mut I) -> Result<PathBuf, ParseSandboxdCommandError>
where
    I: Iterator<Item = String>,
{
    let mut config_path = None;
    while let Some(argument) = parsed_args.next() {
        match argument.as_str() {
            "--config" => {
                config_path =
                    Some(PathBuf::from(parsed_args.next().ok_or(
                        ParseSandboxdCommandError::MissingEgressProxyConfigPath,
                    )?));
            }
            _ => return Err(ParseSandboxdCommandError::UnexpectedArgument(argument)),
        }
    }
    config_path.ok_or(ParseSandboxdCommandError::MissingEgressProxyConfigPath)
}

fn parse_payload_source_args<I>(
    parsed_args: &mut I,
) -> Result<StartupPayloadSource, ParseSandboxdCommandError>
where
    I: Iterator<Item = String>,
{
    let mut payload_source = StartupPayloadSource::StdinUntilEof;
    while let Some(argument) = parsed_args.next() {
        match argument.as_str() {
            "--stdin-bytes" => {
                payload_source = parse_stdin_bytes(parsed_args.next())?;
            }
            _ => return Err(ParseSandboxdCommandError::UnexpectedArgument(argument)),
        }
    }
    Ok(payload_source)
}

fn parse_stdin_bytes(
    value: Option<String>,
) -> Result<StartupPayloadSource, ParseSandboxdCommandError> {
    let value = value.ok_or(ParseSandboxdCommandError::MissingStdinBytesValue)?;
    let byte_count = value
        .parse::<usize>()
        .map_err(|_| ParseSandboxdCommandError::InvalidStdinBytes(value))?;
    Ok(StartupPayloadSource::StdinBytes(byte_count))
}

/// Runs one `sandboxd` CLI invocation against the provided process I/O streams.
pub fn run<I, S, R, W, E>(
    program_name: &str,
    args: I,
    stdin: &mut R,
    stdout: &mut W,
    stderr: &mut E,
) -> i32
where
    I: IntoIterator<Item = S>,
    S: Into<String>,
    R: io::Read,
    W: io::Write,
    E: io::Write,
{
    initialize_sandboxd_tracing();

    let parsed_args: Vec<String> = args.into_iter().map(Into::into).collect();
    let command = if is_signer_alias(program_name) {
        SandboxdCommand::Sign
    } else {
        match parse_sandboxd_command(parsed_args.iter().cloned()) {
            Ok(command) => command,
            Err(error) => {
                let _ = writeln!(stderr, "{error}");
                return 1;
            }
        }
    };

    match command {
        SandboxdCommand::Daemon => {
            if let Err(error) = security::apply_current_process_security() {
                let _ = writeln!(stderr, "{error}");
                return 1;
            }

            let server = match control::start_control_server(
                Path::new(control::DEFAULT_CONTROL_SOCKET_PATH),
                ThreadSleeper,
                control::DEFAULT_CONTROL_ACCEPT_POLL_INTERVAL,
            ) {
                Ok(server) => server,
                Err(error) => {
                    let _ = writeln!(stderr, "{error}");
                    return 1;
                }
            };

            match server.wait() {
                Ok(()) => 0,
                Err(error) => {
                    let _ = writeln!(stderr, "{error}");
                    1
                }
            }
        }
        SandboxdCommand::EgressProxy { config_path } => {
            match egress_proxy::run_egress_proxy_child(&config_path) {
                Ok(()) => 0,
                Err(error) => {
                    let _ = writeln!(stderr, "{error}");
                    1
                }
            }
        }
        SandboxdCommand::Ready => {
            match control::submit_ready(Path::new(control::DEFAULT_CONTROL_SOCKET_PATH)) {
                Ok(()) => 0,
                Err(error) => {
                    let _ = writeln!(stderr, "{error}");
                    1
                }
            }
        }
        SandboxdCommand::Init {
            detach,
            payload_source,
        } => match init::run_init(
            stdin,
            stdout,
            Path::new(control::DEFAULT_CONTROL_SOCKET_PATH),
            detach,
            payload_source,
        ) {
            Ok(()) => 0,
            Err(_) => 1,
        },
        SandboxdCommand::Resume { payload_source } => match resume::run_resume(
            stdin,
            stdout,
            Path::new(control::DEFAULT_CONTROL_SOCKET_PATH),
            payload_source,
        ) {
            Ok(()) => 0,
            Err(_) => 1,
        },
        SandboxdCommand::WaitInit => {
            match wait_init::run_wait_init(stdout, Path::new(control::DEFAULT_CONTROL_SOCKET_PATH))
            {
                Ok(()) => 0,
                Err(_) => 1,
            }
        }
        SandboxdCommand::Version => match writeln!(stdout, "{}", env!("CARGO_PKG_VERSION")) {
            Ok(()) => 0,
            Err(error) => {
                let _ = writeln!(stderr, "failed to write sandboxd version: {error}");
                1
            }
        },
        SandboxdCommand::Sign => match sign::run_sign(parsed_args, &sign_control_socket_path()) {
            Ok(()) => 0,
            Err(error) => {
                let _ = writeln!(stderr, "{error}");
                1
            }
        },
    }
}

fn is_signer_alias(program_name: &str) -> bool {
    Path::new(program_name)
        .file_name()
        .and_then(|value| value.to_str())
        == Some(sign::DEFAULT_SIGNER_ALIAS_NAME)
}

fn sign_control_socket_path() -> PathBuf {
    std::env::var_os("MISTLE_SANDBOXD_CONTROL_SOCKET_PATH")
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from(control::DEFAULT_CONTROL_SOCKET_PATH))
}

#[cfg(test)]
mod tests {
    use crate::{
        ParseSandboxdCommandError, SandboxdCommand, is_signer_alias, parse_sandboxd_command,
        startup_payload::StartupPayloadSource,
    };

    #[test]
    fn defaults_to_daemon_without_args() {
        let command = parse_sandboxd_command(Vec::<String>::new());

        assert_eq!(command, Ok(SandboxdCommand::Daemon));
    }

    #[test]
    fn parses_init() {
        let command = parse_sandboxd_command(["init"]);

        assert_eq!(
            command,
            Ok(SandboxdCommand::Init {
                detach: false,
                payload_source: StartupPayloadSource::StdinUntilEof
            })
        );
    }

    #[test]
    fn parses_detached_init() {
        let command = parse_sandboxd_command(["init", "--detach"]);

        assert_eq!(
            command,
            Ok(SandboxdCommand::Init {
                detach: true,
                payload_source: StartupPayloadSource::StdinUntilEof
            })
        );
    }

    #[test]
    fn parses_init_with_stdin_byte_count() {
        let command = parse_sandboxd_command(["init", "--stdin-bytes", "123", "--detach"]);

        assert_eq!(
            command,
            Ok(SandboxdCommand::Init {
                detach: true,
                payload_source: StartupPayloadSource::StdinBytes(123)
            })
        );
    }

    #[test]
    fn parses_ready() {
        let command = parse_sandboxd_command(["ready"]);

        assert_eq!(command, Ok(SandboxdCommand::Ready));
    }

    #[test]
    fn parses_egress_proxy_with_config_path() {
        let command = parse_sandboxd_command(["egress-proxy", "--config", "/tmp/proxy.json"]);

        assert_eq!(
            command,
            Ok(SandboxdCommand::EgressProxy {
                config_path: "/tmp/proxy.json".into()
            })
        );
    }

    #[test]
    fn rejects_egress_proxy_without_config_path() {
        let command = parse_sandboxd_command(["egress-proxy"]);

        assert_eq!(
            command,
            Err(ParseSandboxdCommandError::MissingEgressProxyConfigPath)
        );
    }

    #[test]
    fn rejects_egress_proxy_config_without_value() {
        let command = parse_sandboxd_command(["egress-proxy", "--config"]);

        assert_eq!(
            command,
            Err(ParseSandboxdCommandError::MissingEgressProxyConfigPath)
        );
    }

    #[test]
    fn parses_resume() {
        let command = parse_sandboxd_command(["resume"]);

        assert_eq!(
            command,
            Ok(SandboxdCommand::Resume {
                payload_source: StartupPayloadSource::StdinUntilEof
            })
        );
    }

    #[test]
    fn parses_resume_with_stdin_byte_count() {
        let command = parse_sandboxd_command(["resume", "--stdin-bytes", "456"]);

        assert_eq!(
            command,
            Ok(SandboxdCommand::Resume {
                payload_source: StartupPayloadSource::StdinBytes(456)
            })
        );
    }

    #[test]
    fn rejects_missing_stdin_byte_count() {
        let command = parse_sandboxd_command(["init", "--stdin-bytes"]);

        assert_eq!(
            command,
            Err(ParseSandboxdCommandError::MissingStdinBytesValue)
        );
    }

    #[test]
    fn rejects_invalid_stdin_byte_count() {
        let command = parse_sandboxd_command(["resume", "--stdin-bytes", "abc"]);

        assert_eq!(
            command,
            Err(ParseSandboxdCommandError::InvalidStdinBytes(
                "abc".to_string()
            ))
        );
    }

    #[test]
    fn parses_wait_init() {
        let command = parse_sandboxd_command(["wait-init"]);

        assert_eq!(command, Ok(SandboxdCommand::WaitInit));
    }

    #[test]
    fn parses_version() {
        let command = parse_sandboxd_command(["version"]);

        assert_eq!(command, Ok(SandboxdCommand::Version));
    }

    #[test]
    fn writes_plaintext_version() {
        let mut stdin = std::io::empty();
        let mut stdout = Vec::new();
        let mut stderr = Vec::new();

        let exit_code = crate::run(
            "sandboxd",
            ["version"],
            &mut stdin,
            &mut stdout,
            &mut stderr,
        );

        assert_eq!(exit_code, 0);
        assert_eq!(
            String::from_utf8(stdout).expect("version output should be utf8"),
            format!("{}\n", env!("CARGO_PKG_VERSION"))
        );
        assert!(stderr.is_empty());
    }

    #[test]
    fn rejects_unknown_subcommand() {
        let command = parse_sandboxd_command(["not-a-command"]);

        assert_eq!(
            command,
            Err(ParseSandboxdCommandError::UnknownCommand(
                "not-a-command".to_string()
            ))
        );
    }

    #[test]
    fn rejects_extra_arguments() {
        let command = parse_sandboxd_command(["init", "--verbose"]);

        assert_eq!(
            command,
            Err(ParseSandboxdCommandError::UnexpectedArgument(
                "--verbose".to_string()
            ))
        );
    }

    #[test]
    fn recognizes_signer_alias_program_name() {
        assert!(is_signer_alias("/opt/mistle/bin/mistle-ssh-sign"));
        assert!(!is_signer_alias("/opt/mistle/bin/sandboxd"));
    }
}
