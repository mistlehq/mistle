mod codex;
mod config;
mod error;
mod format;
mod profile;
mod sandbox;
mod whoami;

use std::io::{self, Write};

use bpaf::{OptionParser, Parser, construct, long, positional, pure};

#[tokio::main]
async fn main() {
    let command = options().run();
    let mut stdout = io::stdout();
    let mut stderr = io::stderr();
    let exit_code = run(command, &mut stdout, &mut stderr).await;
    std::process::exit(exit_code);
}

#[derive(Debug, Clone)]
enum CliCommand {
    Whoami,
    ProfileList,
    ProfileGet {
        profile_id: String,
    },
    SandboxCreate {
        profile_id: String,
        version: Option<u32>,
    },
    SandboxList {
        limit: Option<u32>,
        after: Option<String>,
    },
    SandboxGet {
        sandbox_id: String,
    },
    Codex {
        sandbox_id: String,
        codex_args: Vec<String>,
    },
}

fn options() -> OptionParser<CliCommand> {
    let whoami = pure(CliCommand::Whoami)
        .to_options()
        .descr("Print the current Mistle identity")
        .command("whoami");

    let profile_list = pure(CliCommand::ProfileList)
        .to_options()
        .descr("List sandbox profiles")
        .command("list");

    let profile_id = positional::<String>("profile-id")
        .help("Sandbox profile id")
        .guard(
            |value| !value.trim().is_empty(),
            "profile id cannot be blank",
        );

    let profile_get = profile_id
        .map(|profile_id| CliCommand::ProfileGet { profile_id })
        .to_options()
        .descr("Get a sandbox profile")
        .command("get");

    let profile = construct!([profile_list, profile_get])
        .to_options()
        .descr("Manage sandbox profiles")
        .command("profile");

    let profile_id = long("profile")
        .help("Sandbox profile id")
        .argument::<String>("profile-id")
        .guard(
            |value| !value.trim().is_empty(),
            "profile id cannot be blank",
        );
    let version = long("version")
        .help("Sandbox profile version")
        .argument::<u32>("version")
        .guard(|value| *value > 0, "version must be greater than zero")
        .optional();

    let sandbox_create = construct!(CliCommand::SandboxCreate {
        profile_id,
        version
    })
    .to_options()
    .descr("Create a sandbox")
    .command("create");

    let limit = long("limit")
        .help("Maximum number of sandboxes to return")
        .argument::<u32>("limit")
        .guard(
            |value| (1..=100).contains(value),
            "limit must be between 1 and 100",
        )
        .optional();
    let after = long("after")
        .help("List sandboxes after this cursor")
        .argument::<String>("cursor")
        .guard(
            |value| !value.trim().is_empty(),
            "after cursor cannot be blank",
        )
        .optional();

    let sandbox_list = construct!(CliCommand::SandboxList { limit, after })
        .to_options()
        .descr("List sandboxes")
        .command("list");

    let sandbox_id = positional::<String>("sandbox-id").help("Sandbox id").guard(
        |value| !value.trim().is_empty(),
        "sandbox id cannot be blank",
    );

    let sandbox_get = sandbox_id
        .map(|sandbox_id| CliCommand::SandboxGet { sandbox_id })
        .to_options()
        .descr("Get a sandbox")
        .command("get");

    let sandbox = construct!([sandbox_create, sandbox_list, sandbox_get])
        .to_options()
        .descr("Manage sandboxes")
        .command("sandbox");

    let sandbox_id = long("sandbox")
        .help("Sandbox id")
        .argument::<String>("sandbox-id")
        .guard(
            |value| !value.trim().is_empty(),
            "sandbox id cannot be blank",
        );
    let codex_args = positional::<String>("codex-arg")
        .strict()
        .help("Arguments passed to codex after --")
        .many();
    let codex = construct!(CliCommand::Codex {
        sandbox_id,
        codex_args
    })
    .to_options()
    .descr("Run Codex against a Mistle sandbox")
    .command("codex");

    construct!([whoami, profile, sandbox, codex])
        .to_options()
        .descr("Mistle command line interface")
        .version(env!("CARGO_PKG_VERSION"))
}

async fn run<W, E>(command: CliCommand, stdout: &mut W, stderr: &mut E) -> i32
where
    W: Write,
    E: Write,
{
    match command {
        CliCommand::Whoami => whoami::run(stdout, stderr),
        CliCommand::ProfileList => profile::run_list(stdout, stderr),
        CliCommand::ProfileGet { profile_id } => profile::run_get(&profile_id, stdout, stderr),
        CliCommand::SandboxCreate {
            profile_id,
            version,
        } => sandbox::run_create(&profile_id, version, stdout, stderr),
        CliCommand::SandboxList { limit, after } => sandbox::run_list(limit, after, stdout, stderr),
        CliCommand::SandboxGet { sandbox_id } => sandbox::run_get(&sandbox_id, stdout, stderr),
        CliCommand::Codex {
            sandbox_id,
            codex_args,
        } => codex::run(&sandbox_id, codex_args, stderr).await,
    }
}
