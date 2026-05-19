use std::fmt;
use std::io;

use crate::codex::CodexRunError;
use mstl_core::client::MistleClientError;

#[derive(Debug)]
pub(crate) enum CliError {
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
    ReadFile {
        path: String,
        source: io::Error,
    },
    EmptyFile {
        path: String,
    },
    Codex {
        action: &'static str,
        source: CodexRunError,
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
            Self::ReadFile { path, source } => {
                write!(formatter, "failed to read file `{path}`: {source}")
            }
            Self::EmptyFile { path } => {
                write!(formatter, "file `{path}` cannot be empty")
            }
            Self::Codex { action, source } => {
                write!(formatter, "failed to {action}: {source}")
            }
        }
    }
}

impl std::error::Error for CliError {}
