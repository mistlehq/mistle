use bpaf::{OptionParser, Parser, construct, pure};
use mstl_core::auth::{API_KEY_ENV_VAR, AuthStatus, api_key_auth_status};
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

#[derive(Debug, Clone, Copy)]
enum CliCommand {
    AuthStatus,
}

#[derive(Debug, Clone, PartialEq, Eq)]
enum CliError {
    NonUnicodeEnvironmentVariable { name: &'static str },
}

impl fmt::Display for CliError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::NonUnicodeEnvironmentVariable { name } => {
                write!(formatter, "{name} must be valid Unicode")
            }
        }
    }
}

impl std::error::Error for CliError {}

fn options() -> OptionParser<CliCommand> {
    let auth_status = pure(CliCommand::AuthStatus)
        .to_options()
        .descr("Print authentication status")
        .command("status");

    let auth = construct!([auth_status])
        .to_options()
        .descr("Manage authentication")
        .command("auth");

    construct!([auth])
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
        CliCommand::AuthStatus => match current_auth_status() {
            Ok(AuthStatus::Authenticated) => match writeln!(stdout, "authenticated") {
                Ok(()) => 0,
                Err(error) => {
                    let _ = writeln!(stderr, "failed to write auth status: {error}");
                    1
                }
            },
            Ok(AuthStatus::Unauthenticated) => match writeln!(stdout, "not authenticated") {
                Ok(()) => 1,
                Err(error) => {
                    let _ = writeln!(stderr, "failed to write auth status: {error}");
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

fn current_auth_status() -> Result<AuthStatus, CliError> {
    match env::var(API_KEY_ENV_VAR) {
        Ok(api_key) => Ok(api_key_auth_status(Some(api_key.as_str()))),
        Err(VarError::NotPresent) => Ok(AuthStatus::Unauthenticated),
        Err(VarError::NotUnicode(_)) => Err(CliError::NonUnicodeEnvironmentVariable {
            name: API_KEY_ENV_VAR,
        }),
    }
}
