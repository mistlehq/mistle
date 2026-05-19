use std::io::Write;

pub(crate) mod proxy;

use crate::config::mistle_client;
use crate::error::CliError;

pub(crate) use proxy::CodexRunError;

use proxy::{CodexRunConfig, run_codex, validate_codex_args};

pub(crate) async fn run<W>(sandbox_id: &str, codex_args: Vec<String>, stderr: &mut W) -> i32
where
    W: Write,
{
    match run_codex_for_sandbox(sandbox_id, codex_args).await {
        Ok(()) => 0,
        Err(error) => {
            let _ = writeln!(stderr, "{error}");
            1
        }
    }
}

async fn run_codex_for_sandbox(sandbox_id: &str, codex_args: Vec<String>) -> Result<(), CliError> {
    validate_codex_args(&codex_args).map_err(|source| CliError::Codex {
        action: "validate codex arguments",
        source,
    })?;

    let connection_token = mistle_client()?
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
