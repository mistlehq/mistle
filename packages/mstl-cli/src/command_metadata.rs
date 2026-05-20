pub struct CommandMetadata {
    pub name: &'static str,
    pub description: &'static str,
}

pub struct ArgumentMetadata {
    pub name: &'static str,
    pub description: &'static str,
}

pub const ROOT: CommandMetadata = CommandMetadata {
    name: "mistle",
    description: "Mistle command line interface",
};

pub const WHOAMI: CommandMetadata = CommandMetadata {
    name: "whoami",
    description: "Print the current Mistle identity",
};

pub const UPDATE: CommandMetadata = CommandMetadata {
    name: "update",
    description: "Update the Mistle CLI",
};

pub const PROFILE: CommandMetadata = CommandMetadata {
    name: "profile",
    description: "Manage sandbox profiles",
};

pub const PROFILE_LIST: CommandMetadata = CommandMetadata {
    name: "list",
    description: "List sandbox profiles",
};

pub const PROFILE_GET: CommandMetadata = CommandMetadata {
    name: "get",
    description: "Get a sandbox profile",
};

pub const PROFILE_VERSION: CommandMetadata = CommandMetadata {
    name: "version",
    description: "Manage sandbox profile versions",
};

pub const PROFILE_VERSION_LIST: CommandMetadata = CommandMetadata {
    name: "list",
    description: "List sandbox profile versions",
};

pub const PROFILE_VERSION_SETUP_SCRIPT: CommandMetadata = CommandMetadata {
    name: "setup-script",
    description: "Manage sandbox profile version setup scripts",
};

pub const PROFILE_VERSION_SETUP_SCRIPT_SET: CommandMetadata = CommandMetadata {
    name: "set",
    description: "Set a sandbox profile version setup script",
};

pub const SANDBOX: CommandMetadata = CommandMetadata {
    name: "sandbox",
    description: "Manage sandboxes",
};

pub const SANDBOX_CREATE: CommandMetadata = CommandMetadata {
    name: "create",
    description: "Create a sandbox",
};

pub const SANDBOX_LIST: CommandMetadata = CommandMetadata {
    name: "list",
    description: "List sandboxes",
};

pub const SANDBOX_GET: CommandMetadata = CommandMetadata {
    name: "get",
    description: "Get a sandbox",
};

pub const CODEX: CommandMetadata = CommandMetadata {
    name: "codex",
    description: "Run Codex against a Mistle sandbox",
};

pub const PROFILE_ID: ArgumentMetadata = ArgumentMetadata {
    name: "profile-id",
    description: "Sandbox profile id",
};

pub const PROFILE_VERSION_VALUE: ArgumentMetadata = ArgumentMetadata {
    name: "version",
    description: "Sandbox profile version",
};

pub const SETUP_SCRIPT_FILE: ArgumentMetadata = ArgumentMetadata {
    name: "path",
    description: "Setup script file to upload",
};

pub const SANDBOX_ID: ArgumentMetadata = ArgumentMetadata {
    name: "sandbox-id",
    description: "Sandbox id",
};

pub const SANDBOX_LIST_LIMIT: ArgumentMetadata = ArgumentMetadata {
    name: "limit",
    description: "Maximum number of sandboxes to return",
};

pub const SANDBOX_LIST_AFTER: ArgumentMetadata = ArgumentMetadata {
    name: "cursor",
    description: "List sandboxes after this cursor",
};

pub const CODEX_ARG: ArgumentMetadata = ArgumentMetadata {
    name: "codex-arg",
    description: "Arguments passed to codex after --",
};
