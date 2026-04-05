//! `sandboxd` is the Rust sandbox supervisor binary that is gradually absorbing
//! startup application, local control, process supervision, and tunnel logic
//! from the legacy JavaScript runtime.

use std::fmt;
use std::io;
use std::path::Path;

pub mod apply_startup;
pub mod command;
pub mod control;
pub mod process;
pub mod protocol;
pub mod runtime;
pub mod time;
pub mod security;

use crate::time::ThreadSleeper;

/// Enumerates the top-level `sandboxd` subcommands the CLI currently supports.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SandboxdCommand {
    Serve,
    ApplyStartup,
}

/// Describes why CLI argument parsing failed before any command-specific work ran.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ParseSandboxdCommandError {
    MissingCommand,
    UnexpectedArgument(String),
    UnknownCommand(String),
}

impl fmt::Display for ParseSandboxdCommandError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::MissingCommand => write!(
                f,
                "missing sandboxd subcommand (expected one of: serve, apply-startup)"
            ),
            Self::UnexpectedArgument(argument) => {
                write!(f, "unexpected sandboxd argument: {argument}")
            }
            Self::UnknownCommand(command) => write!(
                f,
                "unknown sandboxd subcommand '{command}' (expected one of: serve, apply-startup)"
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
        return Err(ParseSandboxdCommandError::MissingCommand);
    };

    let command = match command.as_str() {
        "serve" => SandboxdCommand::Serve,
        "apply-startup" => SandboxdCommand::ApplyStartup,
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

/// Runs one `sandboxd` CLI invocation against the provided process I/O streams.
pub fn run<I, S, R, W, E>(args: I, stdin: &mut R, stdout: &mut W, stderr: &mut E) -> i32
where
    I: IntoIterator<Item = S>,
    S: Into<String>,
    R: io::Read,
    W: io::Write,
    E: io::Write,
{
    let command = match parse_sandboxd_command(args) {
        Ok(command) => command,
        Err(error) => {
            let _ = writeln!(stderr, "{error}");
            return 1;
        }
    };

    match command {
        SandboxdCommand::Serve => {
            if let Err(error) = security::apply_current_process_security() {
                let _ = writeln!(stderr, "{error}");
                return 1;
            }

            let server = match control::start_control_server(
                Path::new(control::DEFAULT_CONTROL_SOCKET_PATH),
                Path::new(apply_startup::DEFAULT_MANIFEST_PATH),
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
        SandboxdCommand::ApplyStartup => match apply_startup::run_apply_startup(
            stdin,
            stdout,
            Path::new(apply_startup::DEFAULT_MANIFEST_PATH),
            Path::new(control::DEFAULT_CONTROL_SOCKET_PATH),
        ) {
            Ok(()) => 0,
            Err(_) => 1,
        },
    }
}

#[cfg(test)]
mod tests {
    use crate::{ParseSandboxdCommandError, SandboxdCommand, parse_sandboxd_command};

    #[test]
    fn parses_serve() {
        let command = parse_sandboxd_command(["serve"]);

        assert_eq!(command, Ok(SandboxdCommand::Serve));
    }

    #[test]
    fn parses_apply_startup() {
        let command = parse_sandboxd_command(["apply-startup"]);

        assert_eq!(command, Ok(SandboxdCommand::ApplyStartup));
    }

    #[test]
    fn rejects_missing_subcommand() {
        let command = parse_sandboxd_command(Vec::<String>::new());

        assert_eq!(command, Err(ParseSandboxdCommandError::MissingCommand));
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
        let command = parse_sandboxd_command(["serve", "--verbose"]);

        assert_eq!(
            command,
            Err(ParseSandboxdCommandError::UnexpectedArgument(
                "--verbose".to_string()
            ))
        );
    }
}
