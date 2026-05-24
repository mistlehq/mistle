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
    MissingAuthFile,
    ReadAuthFile {
        path: String,
        source: io::Error,
    },
    ParseAuthFile {
        path: String,
        source: serde_json::Error,
    },
    InvalidAuthFile {
        path: String,
        message: &'static str,
    },
    CreateAuthDirectory {
        path: String,
        source: io::Error,
    },
    WriteAuthFile {
        path: String,
        source: io::Error,
    },
    SerializeAuthFile {
        source: serde_json::Error,
    },
    RemoveAuthFile {
        path: String,
        source: io::Error,
    },
    Login {
        action: &'static str,
        source: Box<dyn std::error::Error + Send + Sync>,
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
            Self::MissingAuthFile => {
                write!(
                    formatter,
                    "missing Mistle authentication; run `mistle login` or set MISTLE_API_KEY"
                )
            }
            Self::ReadAuthFile { path, source } => {
                write!(formatter, "failed to read auth file `{path}`: {source}")
            }
            Self::ParseAuthFile { path, source } => {
                write!(formatter, "failed to parse auth file `{path}`: {source}")
            }
            Self::InvalidAuthFile { path, message } => {
                write!(formatter, "invalid auth file `{path}`: {message}")
            }
            Self::CreateAuthDirectory { path, source } => {
                write!(
                    formatter,
                    "failed to create auth directory `{path}`: {source}"
                )
            }
            Self::WriteAuthFile { path, source } => {
                write!(formatter, "failed to write auth file `{path}`: {source}")
            }
            Self::SerializeAuthFile { source } => {
                write!(formatter, "failed to serialize auth file: {source}")
            }
            Self::RemoveAuthFile { path, source } => {
                write!(formatter, "failed to remove auth file `{path}`: {source}")
            }
            Self::Login { action, source } => {
                write!(formatter, "failed to {action}: {source}")
            }
            Self::Codex { action, source } => {
                write!(formatter, "failed to {action}: {source}")
            }
        }
    }
}

impl std::error::Error for CliError {}
