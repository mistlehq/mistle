use std::io::{self, Write};

use mstl_core::client::{CurrentActor, CurrentActorAuthentication};

use crate::config::mistle_client;
use crate::error::CliError;

pub(crate) fn run<W, E>(stdout: &mut W, stderr: &mut E) -> i32
where
    W: Write,
    E: Write,
{
    match current_actor() {
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
