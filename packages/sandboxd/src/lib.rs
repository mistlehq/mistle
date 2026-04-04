use std::fmt;

pub mod protocol;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SandboxdCommand {
    Serve,
    ApplyStartup,
}

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

pub fn run<I, S>(args: I) -> Result<(), ParseSandboxdCommandError>
where
    I: IntoIterator<Item = S>,
    S: Into<String>,
{
    let _command = parse_sandboxd_command(args)?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::{ParseSandboxdCommandError, SandboxdCommand, parse_sandboxd_command};

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
