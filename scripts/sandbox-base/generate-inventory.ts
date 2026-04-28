import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";

import {
  SandboxBaseInventorySpec,
  type SandboxBaseInventoryToolCategory,
  type SandboxBaseInventoryToolSpec,
} from "./inventory-spec.js";

type ScriptMode = "check" | "write";

type SandboxBaseInventory = {
  baseOs: string;
  dockerfilePath: string;
  imageRef: string;
  runtimeBase: SandboxBaseInventoryRuntimeBase;
  tools: readonly SandboxBaseInventoryTool[];
};

type SandboxBaseInventoryRuntimeBase = {
  os: {
    id: string;
    prettyName: string;
    versionId: string;
  };
  packageManagers: readonly string[];
  shell: string;
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

const RepoRoot = new URL("../../", import.meta.url);
const InventoryPath = new URL(`../../${SandboxBaseInventorySpec.inventoryPath}`, import.meta.url);

function parseMode(argv: readonly string[]): ScriptMode {
  if (argv.length !== 1 || (argv[0] !== "--write" && argv[0] !== "--check")) {
    throw new Error("Usage: tsx scripts/sandbox-base/generate-inventory.ts --write|--check");
  }

  return argv[0] === "--write" ? "write" : "check";
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
    [
      "build",
      "--target",
      "sandbox-base",
      "--tag",
      imageRef,
      "--file",
      SandboxBaseInventorySpec.dockerfilePath,
      ".",
    ],
    {
      cwd: RepoRoot,
      stdio: "inherit",
    },
  );
}

function commandExists(imageRef: string, command: string): boolean {
  const result = runInImage(imageRef, [
    "/bin/bash",
    "-lc",
    'if command -v "$1" >/dev/null 2>&1; then printf found; else printf missing; fi',
    "command-exists",
    command,
  ]).trim();

  if (result === "found") {
    return true;
  }

  if (result === "missing") {
    return false;
  }

  throw new Error(`Unexpected command probe result for '${command}': ${result}`);
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
    packageManagers: SandboxBaseInventorySpec.packageManagerCommands.filter((command) =>
      commandExists(imageRef, command),
    ),
    shell,
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

function collectTool(
  imageRef: string,
  probe: SandboxBaseInventoryToolSpec,
): SandboxBaseInventoryTool {
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

function collectInventory(imageRef: string): SandboxBaseInventory {
  buildImage(imageRef);
  const runtimeBase = readRuntimeBase(imageRef);

  return {
    baseOs: runtimeBase.os.prettyName,
    dockerfilePath: SandboxBaseInventorySpec.dockerfilePath,
    imageRef,
    runtimeBase,
    tools: SandboxBaseInventorySpec.tools.map((probe) => collectTool(imageRef, probe)),
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
  const imageRef =
    process.env.MISTLE_SANDBOX_BASE_INVENTORY_IMAGE ?? SandboxBaseInventorySpec.defaultImageRef;
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
