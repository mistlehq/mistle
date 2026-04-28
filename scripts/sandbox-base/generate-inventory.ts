import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";

type ScriptMode = "check" | "write";

type InventoryToolProbe = {
  category: SandboxBaseInventoryToolCategory;
  command: string;
  displayName: string;
  versionCommand: readonly string[];
  versionParser: (output: string) => string;
};

type SandboxBaseInventory = {
  baseOs: string;
  dockerfilePath: string;
  imageRef: string;
  runtimeBase: SandboxBaseInventoryRuntimeBase;
  tools: readonly SandboxBaseInventoryTool[];
  notPreinstalled: readonly SandboxBaseInventoryMissingTool[];
};

type SandboxBaseInventoryRuntimeBase = {
  os: {
    id: string;
    prettyName: string;
    versionId: string;
  };
  packageManagers: readonly string[];
  shell: string;
  sudoInstalled: boolean;
  user: {
    name: string;
    uid: number;
  };
  workingDirectory: string;
};

type SandboxBaseInventoryTool = {
  category: SandboxBaseInventoryToolCategory;
  command: string;
  displayName: string;
  version: string;
};

type SandboxBaseInventoryToolCategory = {
  id: string;
  title: string;
};

type SandboxBaseInventoryMissingTool = {
  command: string;
  displayName: string;
};

const RepoRoot = new URL("../../", import.meta.url);
const DockerfilePath = "packages/sandboxd/Dockerfile";
const InventoryPath = new URL(
  "../../packages/sandboxd/sandbox-base-inventory.generated.json",
  import.meta.url,
);
const DefaultImageRef = "mistle/sandbox-base-inventory:local";

const ToolCategories = {
  RUNTIMES: {
    id: "runtimes",
    title: "Runtimes",
  },
  PACKAGE_AND_ENVIRONMENT: {
    id: "package-and-environment",
    title: "Package and environment",
  },
  CONTAINERS: {
    id: "containers",
    title: "Containers",
  },
  CLI_UTILITIES: {
    id: "cli-utilities",
    title: "CLI utilities",
  },
  DEBUGGING_AND_SYSTEM: {
    id: "debugging-and-system",
    title: "Debugging and system",
  },
} satisfies Record<string, SandboxBaseInventoryToolCategory>;

const ToolProbes = [
  {
    category: ToolCategories.RUNTIMES,
    command: "node",
    displayName: "Node.js",
    versionCommand: ["node", "--version"],
    versionParser: parseLeadingVVersion,
  },
  {
    category: ToolCategories.PACKAGE_AND_ENVIRONMENT,
    command: "npm",
    displayName: "npm",
    versionCommand: ["npm", "--version"],
    versionParser: parseFirstLine,
  },
  {
    category: ToolCategories.PACKAGE_AND_ENVIRONMENT,
    command: "npx",
    displayName: "npx",
    versionCommand: ["npx", "--version"],
    versionParser: parseFirstLine,
  },
  {
    category: ToolCategories.PACKAGE_AND_ENVIRONMENT,
    command: "corepack",
    displayName: "Corepack",
    versionCommand: ["corepack", "--version"],
    versionParser: parseFirstLine,
  },
  {
    category: ToolCategories.RUNTIMES,
    command: "python3",
    displayName: "Python",
    versionCommand: ["python3", "--version"],
    versionParser: parseTrailingVersion,
  },
  {
    category: ToolCategories.PACKAGE_AND_ENVIRONMENT,
    command: "pip",
    displayName: "pip",
    versionCommand: ["pip", "--version"],
    versionParser: parseSecondToken,
  },
  {
    category: ToolCategories.CONTAINERS,
    command: "docker",
    displayName: "Docker",
    versionCommand: ["docker", "--version"],
    versionParser: parseDockerVersion,
  },
  {
    category: ToolCategories.CONTAINERS,
    command: "docker-compose",
    displayName: "Docker Compose",
    versionCommand: ["docker-compose", "version", "--short"],
    versionParser: parseFirstLine,
  },
  {
    category: ToolCategories.CONTAINERS,
    command: "containerd",
    displayName: "containerd",
    versionCommand: ["containerd", "--version"],
    versionParser: parseContainerdVersion,
  },
  {
    category: ToolCategories.CONTAINERS,
    command: "runc",
    displayName: "runc",
    versionCommand: ["runc", "--version"],
    versionParser: parseTrailingVersion,
  },
  {
    category: ToolCategories.PACKAGE_AND_ENVIRONMENT,
    command: "nix",
    displayName: "Nix",
    versionCommand: ["nix", "--version"],
    versionParser: parseLastToken,
  },
  {
    category: ToolCategories.PACKAGE_AND_ENVIRONMENT,
    command: "mise",
    displayName: "mise",
    versionCommand: ["mise", "--version"],
    versionParser: parseFirstToken,
  },
  {
    category: ToolCategories.PACKAGE_AND_ENVIRONMENT,
    command: "archil",
    displayName: "Archil",
    versionCommand: ["archil", "--version"],
    versionParser: parseArchilVersion,
  },
  {
    category: ToolCategories.CLI_UTILITIES,
    command: "git",
    displayName: "Git",
    versionCommand: ["git", "--version"],
    versionParser: parseTrailingVersion,
  },
  {
    category: ToolCategories.CLI_UTILITIES,
    command: "curl",
    displayName: "curl",
    versionCommand: ["curl", "--version"],
    versionParser: parseSecondToken,
  },
  {
    category: ToolCategories.CLI_UTILITIES,
    command: "jq",
    displayName: "jq",
    versionCommand: ["jq", "--version"],
    versionParser: parseJqVersion,
  },
  {
    category: ToolCategories.CLI_UTILITIES,
    command: "rg",
    displayName: "ripgrep",
    versionCommand: ["rg", "--version"],
    versionParser: parseTrailingVersion,
  },
  {
    category: ToolCategories.CLI_UTILITIES,
    command: "fd",
    displayName: "fd",
    versionCommand: ["fd", "--version"],
    versionParser: parseTrailingVersion,
  },
  {
    category: ToolCategories.CLI_UTILITIES,
    command: "bat",
    displayName: "bat",
    versionCommand: ["bat", "--version"],
    versionParser: parseTrailingVersion,
  },
  {
    category: ToolCategories.CLI_UTILITIES,
    command: "tmux",
    displayName: "tmux",
    versionCommand: ["tmux", "-V"],
    versionParser: parseTrailingVersion,
  },
  {
    category: ToolCategories.CLI_UTILITIES,
    command: "vim",
    displayName: "Vim",
    versionCommand: ["vim", "--version"],
    versionParser: parseVimVersion,
  },
  {
    category: ToolCategories.CLI_UTILITIES,
    command: "sqlite3",
    displayName: "SQLite",
    versionCommand: ["sqlite3", "--version"],
    versionParser: parseFirstToken,
  },
  {
    category: ToolCategories.DEBUGGING_AND_SYSTEM,
    command: "make",
    displayName: "Make",
    versionCommand: ["make", "--version"],
    versionParser: parseTrailingVersion,
  },
  {
    category: ToolCategories.DEBUGGING_AND_SYSTEM,
    command: "gdb",
    displayName: "gdb",
    versionCommand: ["gdb", "--version"],
    versionParser: parseTrailingVersion,
  },
  {
    category: ToolCategories.DEBUGGING_AND_SYSTEM,
    command: "strace",
    displayName: "strace",
    versionCommand: ["strace", "--version"],
    versionParser: parseTrailingVersion,
  },
  {
    category: ToolCategories.DEBUGGING_AND_SYSTEM,
    command: "tcpdump",
    displayName: "tcpdump",
    versionCommand: ["tcpdump", "--version"],
    versionParser: parseTrailingVersion,
  },
  {
    category: ToolCategories.DEBUGGING_AND_SYSTEM,
    command: "tree",
    displayName: "tree",
    versionCommand: ["tree", "--version"],
    versionParser: parseSecondTokenWithoutLeadingV,
  },
  {
    category: ToolCategories.DEBUGGING_AND_SYSTEM,
    command: "tini",
    displayName: "tini",
    versionCommand: ["tini", "--version"],
    versionParser: parseTrailingVersion,
  },
] satisfies readonly InventoryToolProbe[];

const MissingToolProbes = [
  { command: "pnpm", displayName: "pnpm" },
  { command: "yarn", displayName: "Yarn" },
  { command: "rustc", displayName: "rustc" },
  { command: "cargo", displayName: "Cargo" },
] satisfies readonly SandboxBaseInventoryMissingTool[];

const PackageManagerCommands: readonly string[] = [
  "apt-get",
  "apt",
  "apk",
  "dnf",
  "yum",
  "pacman",
  "brew",
];

function parseMode(argv: readonly string[]): ScriptMode {
  if (argv.length !== 1 || (argv[0] !== "--write" && argv[0] !== "--check")) {
    throw new Error("Usage: tsx scripts/sandbox-base/generate-inventory.ts --write|--check");
  }

  return argv[0] === "--write" ? "write" : "check";
}

function parseFirstLine(output: string): string {
  const line = output.trim().split("\n")[0]?.trim();

  if (line === undefined || line.length === 0) {
    throw new Error("Expected version command to print at least one line.");
  }

  return line;
}

function parseFirstToken(output: string): string {
  return parseRequiredToken(output, 0);
}

function parseSecondToken(output: string): string {
  return parseRequiredToken(output, 1);
}

function parseSecondTokenWithoutLeadingV(output: string): string {
  return parseSecondToken(output).replace(/^v/u, "");
}

function parseLastToken(output: string): string {
  const tokens = parseFirstLine(output).split(/\s+/u);
  const token = tokens[tokens.length - 1];

  if (token === undefined || token.length === 0) {
    throw new Error(`Could not parse version from output: ${output}`);
  }

  return token;
}

function parseRequiredToken(output: string, index: number): string {
  const token = parseFirstLine(output).split(/\s+/u)[index];

  if (token === undefined || token.length === 0) {
    throw new Error(`Could not parse token ${String(index)} from output: ${output}`);
  }

  return token;
}

function parseLeadingVVersion(output: string): string {
  return parseFirstLine(output).replace(/^v/u, "");
}

function parseTrailingVersion(output: string): string {
  return parseLastToken(output).replace(/^v/u, "");
}

function parseDockerVersion(output: string): string {
  return parseRequiredToken(output.replaceAll(",", ""), 2);
}

function parseContainerdVersion(output: string): string {
  return parseRequiredToken(output, 2).replace(/^v/u, "");
}

function parseJqVersion(output: string): string {
  return parseFirstLine(output).replace(/^jq-/u, "");
}

function parseVimVersion(output: string): string {
  const versionMatch = /\b\d+\.\d+\b/u.exec(parseFirstLine(output));

  if (versionMatch === null) {
    throw new Error(`Could not parse Vim version from output: ${output}`);
  }

  return versionMatch[0];
}

function parseArchilVersion(output: string): string {
  const versionMatch = /^Archil Client:\s*(\S+)/u.exec(parseFirstLine(output));

  if (versionMatch === null) {
    throw new Error(`Could not parse Archil version from output: ${output}`);
  }

  const version = versionMatch[1];

  if (version === undefined) {
    throw new Error(`Could not parse Archil version from output: ${output}`);
  }

  return version.replace(/,$/u, "");
}

function runDocker(input: readonly string[]): string {
  return execFileSync("docker", input, {
    cwd: RepoRoot,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
}

function runInImage(imageRef: string, command: readonly string[]): string {
  return runDocker([
    "run",
    "--rm",
    "--entrypoint",
    command[0] ?? failMissingCommand(),
    imageRef,
    ...command.slice(1),
  ]);
}

function failMissingCommand(): never {
  throw new Error("Expected command array to include an executable.");
}

function buildImage(imageRef: string): void {
  execFileSync(
    "docker",
    ["build", "--target", "sandbox-base", "--tag", imageRef, "--file", DockerfilePath, "."],
    {
      cwd: RepoRoot,
      stdio: "inherit",
    },
  );
}

function commandExists(imageRef: string, command: string): boolean {
  try {
    runInImage(imageRef, ["/bin/bash", "-lc", `command -v ${command} >/dev/null`]);
    return true;
  } catch {
    return false;
  }
}

function readRuntimeBase(imageRef: string): SandboxBaseInventoryRuntimeBase {
  const rawOutput = runInImage(imageRef, [
    "/bin/bash",
    "-lc",
    [
      "set -e",
      ". /etc/os-release",
      'uid="$(id -u)"',
      'user_name="$(id -un)"',
      'shell="$(awk -F: -v uid="$uid" \'$3 == uid { print $7 }\' /etc/passwd)"',
      'working_directory="$(pwd)"',
      'printf \'%s\\n%s\\n%s\\n%s\\n%s\\n%s\\n%s\\n\' "$PRETTY_NAME" "$ID" "${VERSION_ID:-}" "$user_name" "$uid" "$shell" "$working_directory"',
    ].join("; "),
  ]);
  const lines = rawOutput.trim().split("\n");
  const prettyName = readRequiredLine(lines, 0, "OS pretty name");
  const id = readRequiredLine(lines, 1, "OS id");
  const versionId = readRequiredLine(lines, 2, "OS version id");
  const userName = readRequiredLine(lines, 3, "user name");
  const rawUid = readRequiredLine(lines, 4, "user uid");
  const shell = readRequiredLine(lines, 5, "user shell");
  const workingDirectory = readRequiredLine(lines, 6, "working directory");
  const uid = Number.parseInt(rawUid, 10);

  if (!Number.isSafeInteger(uid)) {
    throw new Error(`Expected user uid to be an integer, received '${rawUid}'.`);
  }

  return {
    os: {
      id,
      prettyName,
      versionId,
    },
    packageManagers: PackageManagerCommands.filter((command) => commandExists(imageRef, command)),
    shell,
    sudoInstalled: commandExists(imageRef, "sudo"),
    user: {
      name: userName,
      uid,
    },
    workingDirectory,
  };
}

function readRequiredLine(lines: readonly string[], index: number, label: string): string {
  const line = lines[index]?.trim();

  if (line === undefined || line.length === 0) {
    throw new Error(`Expected runtime base probe to return ${label}.`);
  }

  return line;
}

function collectTool(imageRef: string, probe: InventoryToolProbe): SandboxBaseInventoryTool {
  if (!commandExists(imageRef, probe.command)) {
    throw new Error(`Expected sandbox base image '${imageRef}' to include '${probe.command}'.`);
  }

  const rawVersion = runInImage(imageRef, probe.versionCommand);
  const version = probe.versionParser(rawVersion);

  if (version.length === 0) {
    throw new Error(`Version parser returned an empty version for '${probe.command}'.`);
  }

  return {
    category: probe.category,
    command: probe.command,
    displayName: probe.displayName,
    version,
  };
}

function collectMissingTool(imageRef: string, tool: SandboxBaseInventoryMissingTool): void {
  if (commandExists(imageRef, tool.command)) {
    throw new Error(
      `Expected '${tool.command}' to be absent from sandbox base image '${imageRef}', but it is installed.`,
    );
  }
}

function collectInventory(imageRef: string): SandboxBaseInventory {
  buildImage(imageRef);
  const runtimeBase = readRuntimeBase(imageRef);

  for (const missingTool of MissingToolProbes) {
    collectMissingTool(imageRef, missingTool);
  }

  return {
    baseOs: runtimeBase.os.prettyName,
    dockerfilePath: DockerfilePath,
    imageRef,
    notPreinstalled: MissingToolProbes,
    runtimeBase,
    tools: ToolProbes.map((probe) => collectTool(imageRef, probe)),
  };
}

function stringifyInventory(inventory: SandboxBaseInventory): string {
  return execFileSync("pnpm", ["exec", "oxfmt", "--stdin-filepath", InventoryPath.pathname], {
    cwd: RepoRoot,
    encoding: "utf8",
    input: `${JSON.stringify(inventory, null, 2)}\n`,
    stdio: ["pipe", "pipe", "pipe"],
  });
}

function main(): void {
  const mode = parseMode(process.argv.slice(2));
  const imageRef = process.env.MISTLE_SANDBOX_BASE_INVENTORY_IMAGE ?? DefaultImageRef;
  const nextInventoryText = stringifyInventory(collectInventory(imageRef));

  if (mode === "write") {
    writeFileSync(InventoryPath, nextInventoryText, "utf8");
    process.stdout.write(`Wrote ${InventoryPath.pathname}\n`);
    return;
  }

  const currentInventoryText = existsSync(InventoryPath) ? readFileSync(InventoryPath, "utf8") : "";

  if (currentInventoryText !== nextInventoryText) {
    throw new Error(
      "Sandbox base inventory is stale. Run 'pnpm sandbox-base:inventory:update' and commit the generated file.",
    );
  }

  process.stdout.write("Sandbox base inventory is up to date.\n");
}

main();
