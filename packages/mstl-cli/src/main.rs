use bpaf::{OptionParser, Parser, construct, pure};
use mstl_core::auth::API_KEY_ENV_VAR;
use mstl_core::client::{
    CurrentActor, CurrentActorAuthentication, MistleClient, MistleClientConfig, MistleClientError,
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

#[derive(Debug, Clone, Copy)]
enum CliCommand {
    Whoami,
}

#[derive(Debug)]
enum CliError {
    MissingEnvironmentVariable { name: &'static str },
    BlankEnvironmentVariable { name: &'static str },
    NonUnicodeEnvironmentVariable { name: &'static str },
    Client(MistleClientError),
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
            Self::Client(error) => {
                write!(formatter, "failed to get current Mistle identity: {error}")
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

    construct!([whoami])
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
    }
}

fn current_actor() -> Result<CurrentActor, CliError> {
    let api_key = required_env_var(API_KEY_ENV_VAR)?;
    let base_url = required_env_var(CONTROL_PLANE_API_PUBLIC_URL_ENV_VAR)?;

    MistleClient::new(MistleClientConfig { base_url, api_key })
        .map_err(CliError::Client)?
        .current_actor()
        .map_err(CliError::Client)
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
