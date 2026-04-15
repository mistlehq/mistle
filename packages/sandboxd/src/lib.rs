//! `sandboxd` is the long-lived sandbox supervisor daemon.
//!
//! The default entrypoint runs the daemon behind the local Unix control socket.
//! The supported subcommands, `init` and `resume`, are thin local clients that
//! read one startup payload from stdin, submit it to the running daemon, print
//! the daemon response, and exit.

use std::fmt;
use std::io;
use std::path::Path;

pub mod bootstrap;
pub mod cgroups;
pub mod codex_proxy;
pub mod command;
pub mod control;
pub mod egress_proxy;
pub mod init;
pub mod keepalive;
pub mod process;
pub mod protocol;
pub mod proxy_ca;
pub mod pty;
pub mod resume;
pub mod runtime;
pub mod sandboxd_state;
pub mod security;
pub mod supervision;
#[doc(hidden)]
pub mod test_support;
pub mod time;
pub mod tunnel;

use crate::time::ThreadSleeper;

/// Enumerates the top-level `sandboxd` subcommands the CLI currently supports.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SandboxdCommand {
    Daemon,
    Init,
    Resume,
}

/// Describes why CLI argument parsing failed before any command-specific work ran.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ParseSandboxdCommandError {
    UnexpectedArgument(String),
    UnknownCommand(String),
}

impl fmt::Display for ParseSandboxdCommandError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::UnexpectedArgument(argument) => {
                write!(f, "unexpected sandboxd argument: {argument}")
            }
            Self::UnknownCommand(command) => write!(
                f,
                "unknown sandboxd subcommand '{command}' (expected 'init' or 'resume')"
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
        "init" => SandboxdCommand::Init,
        "resume" => SandboxdCommand::Resume,
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
        SandboxdCommand::Init => match init::run_init(
            stdin,
            stdout,
            Path::new(control::DEFAULT_CONTROL_SOCKET_PATH),
        ) {
            Ok(()) => 0,
            Err(_) => 1,
        },
        SandboxdCommand::Resume => match resume::run_resume(
            stdin,
            stdout,
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
    fn defaults_to_daemon_without_args() {
        let command = parse_sandboxd_command(Vec::<String>::new());

        assert_eq!(command, Ok(SandboxdCommand::Daemon));
    }

    #[test]
    fn parses_init() {
        let command = parse_sandboxd_command(["init"]);

        assert_eq!(command, Ok(SandboxdCommand::Init));
    }

    #[test]
    fn parses_resume() {
        let command = parse_sandboxd_command(["resume"]);

        assert_eq!(command, Ok(SandboxdCommand::Resume));
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
}
