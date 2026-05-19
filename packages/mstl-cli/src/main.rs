mod codex;
mod command_metadata;
mod config;
mod error;
mod format;
mod profile;
mod sandbox;
mod update;
mod whoami;

use std::io::{self, Write};
use std::path::PathBuf;

use bpaf::{OptionParser, Parser, construct, long, positional, pure};

use crate::command_metadata::{
    CODEX, CODEX_ARG, PROFILE, PROFILE_GET, PROFILE_ID, PROFILE_LIST, PROFILE_VERSION,
    PROFILE_VERSION_LIST, PROFILE_VERSION_SETUP_SCRIPT, PROFILE_VERSION_SETUP_SCRIPT_SET,
    PROFILE_VERSION_VALUE, ROOT, SANDBOX, SANDBOX_CREATE, SANDBOX_GET, SANDBOX_ID, SANDBOX_LIST,
    SANDBOX_LIST_AFTER, SANDBOX_LIST_LIMIT, SETUP_SCRIPT_FILE, UPDATE, WHOAMI,
};

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
    Update,
    ProfileList,
    ProfileGet {
        profile_id: String,
    },
    ProfileVersionList {
        profile_id: String,
    },
    ProfileVersionSetupScriptSet {
        profile_id: String,
        version: u32,
        file: PathBuf,
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
        .descr(WHOAMI.description)
        .command(WHOAMI.name);

    let update = pure(CliCommand::Update)
        .to_options()
        .descr(UPDATE.description)
        .command(UPDATE.name);

    let profile_list = pure(CliCommand::ProfileList)
        .to_options()
        .descr(PROFILE_LIST.description)
        .command(PROFILE_LIST.name);

    let profile_id = positional::<String>(PROFILE_ID.name)
        .help(PROFILE_ID.description)
        .guard(
            |value| !value.trim().is_empty(),
            "profile id cannot be blank",
        );

    let profile_get = profile_id
        .map(|profile_id| CliCommand::ProfileGet { profile_id })
        .to_options()
        .descr(PROFILE_GET.description)
        .command(PROFILE_GET.name);

    let profile_version_profile_id = long("profile")
        .help(PROFILE_ID.description)
        .argument::<String>(PROFILE_ID.name)
        .guard(
            |value| !value.trim().is_empty(),
            "profile id cannot be blank",
        );
    let profile_version_list = profile_version_profile_id
        .map(|profile_id| CliCommand::ProfileVersionList { profile_id })
        .to_options()
        .descr(PROFILE_VERSION_LIST.description)
        .command(PROFILE_VERSION_LIST.name);
    let profile_id = long("profile")
        .help(PROFILE_ID.description)
        .argument::<String>(PROFILE_ID.name)
        .guard(
            |value| !value.trim().is_empty(),
            "profile id cannot be blank",
        );
    let version = long("version")
        .help(PROFILE_VERSION_VALUE.description)
        .argument::<u32>(PROFILE_VERSION_VALUE.name)
        .guard(|value| *value > 0, "version must be greater than zero");
    let file = long("file")
        .help(SETUP_SCRIPT_FILE.description)
        .argument::<PathBuf>(SETUP_SCRIPT_FILE.name);
    let profile_version_setup_script_set = construct!(CliCommand::ProfileVersionSetupScriptSet {
        profile_id,
        version,
        file,
    })
    .to_options()
    .descr(PROFILE_VERSION_SETUP_SCRIPT_SET.description)
    .command(PROFILE_VERSION_SETUP_SCRIPT_SET.name);
    let profile_version_setup_script = construct!([profile_version_setup_script_set])
        .to_options()
        .descr(PROFILE_VERSION_SETUP_SCRIPT.description)
        .command(PROFILE_VERSION_SETUP_SCRIPT.name);
    let profile_version = construct!([profile_version_list, profile_version_setup_script])
        .to_options()
        .descr(PROFILE_VERSION.description)
        .command(PROFILE_VERSION.name);

    let profile = construct!([profile_list, profile_get, profile_version])
        .to_options()
        .descr(PROFILE.description)
        .command(PROFILE.name);

    let profile_id = long("profile")
        .help(PROFILE_ID.description)
        .argument::<String>(PROFILE_ID.name)
        .guard(
            |value| !value.trim().is_empty(),
            "profile id cannot be blank",
        );
    let version = long("version")
        .help(PROFILE_VERSION_VALUE.description)
        .argument::<u32>(PROFILE_VERSION_VALUE.name)
        .guard(|value| *value > 0, "version must be greater than zero")
        .optional();

    let sandbox_create = construct!(CliCommand::SandboxCreate {
        profile_id,
        version
    })
    .to_options()
    .descr(SANDBOX_CREATE.description)
    .command(SANDBOX_CREATE.name);

    let limit = long("limit")
        .help(SANDBOX_LIST_LIMIT.description)
        .argument::<u32>(SANDBOX_LIST_LIMIT.name)
        .guard(
            |value| (1..=100).contains(value),
            "limit must be between 1 and 100",
        )
        .optional();
    let after = long("after")
        .help(SANDBOX_LIST_AFTER.description)
        .argument::<String>(SANDBOX_LIST_AFTER.name)
        .guard(
            |value| !value.trim().is_empty(),
            "after cursor cannot be blank",
        )
        .optional();

    let sandbox_list = construct!(CliCommand::SandboxList { limit, after })
        .to_options()
        .descr(SANDBOX_LIST.description)
        .command(SANDBOX_LIST.name);

    let sandbox_id = positional::<String>(SANDBOX_ID.name)
        .help(SANDBOX_ID.description)
        .guard(
            |value| !value.trim().is_empty(),
            "sandbox id cannot be blank",
        );

    let sandbox_get = sandbox_id
        .map(|sandbox_id| CliCommand::SandboxGet { sandbox_id })
        .to_options()
        .descr(SANDBOX_GET.description)
        .command(SANDBOX_GET.name);

    let sandbox = construct!([sandbox_create, sandbox_list, sandbox_get])
        .to_options()
        .descr(SANDBOX.description)
        .command(SANDBOX.name);

    let sandbox_id = long("sandbox")
        .help(SANDBOX_ID.description)
        .argument::<String>(SANDBOX_ID.name)
        .guard(
            |value| !value.trim().is_empty(),
            "sandbox id cannot be blank",
        );
    let codex_args = positional::<String>(CODEX_ARG.name)
        .strict()
        .help(CODEX_ARG.description)
        .many();
    let codex = construct!(CliCommand::Codex {
        sandbox_id,
        codex_args
    })
    .to_options()
    .descr(CODEX.description)
    .command(CODEX.name);

    construct!([whoami, update, profile, sandbox, codex])
        .to_options()
        .descr(ROOT.description)
        .version(env!("CARGO_PKG_VERSION"))
}

async fn run<W, E>(command: CliCommand, stdout: &mut W, stderr: &mut E) -> i32
where
    W: Write,
    E: Write,
{
    match command {
        CliCommand::Whoami => whoami::run(stdout, stderr),
        CliCommand::Update => update::run(stdout, stderr),
        CliCommand::ProfileList => profile::run_list(stdout, stderr),
        CliCommand::ProfileGet { profile_id } => profile::run_get(&profile_id, stdout, stderr),
        CliCommand::ProfileVersionList { profile_id } => {
            profile::run_version_list(&profile_id, stdout, stderr)
        }
        CliCommand::ProfileVersionSetupScriptSet {
            profile_id,
            version,
            file,
        } => profile::run_version_setup_script_set(&profile_id, version, &file, stdout, stderr),
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
