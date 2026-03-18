import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ScriptDirectoryPath = dirname(fileURLToPath(import.meta.url));
const RepositoryRootPath = resolve(ScriptDirectoryPath, "../..");
const SeaOutputPath = resolve(RepositoryRootPath, "apps/sandbox-runtime/dist-sea");
const NodeToolchainImage = "node:25-bookworm-slim";

function resolveContainerPlatform() {
  switch (process.arch) {
    case "arm64":
      return "linux/arm64";
    case "x64":
      return "linux/amd64";
    default:
      throw new Error(`unsupported local architecture '${process.arch}' for Linux SEA build`);
  }
}

function runCommand(command, args, cwd = RepositoryRootPath) {
  execFileSync(command, args, {
    cwd,
    stdio: "inherit",
  });
}

function buildCopyCommand() {
  const tarCommand = [
    "tar",
    "--exclude=.git",
    "--exclude=.turbo",
    "--exclude=node_modules",
    "--exclude=apps/sandbox-runtime/dist-sea",
    "-cf",
    "-",
    ".",
  ].join(" ");

  return `set -euo pipefail && mkdir -p /work && cd /src && ${tarCommand} | tar -xf - -C /work`;
}

function buildSeaCommand() {
  return [
    "set -euo pipefail",
    "cd /work",
    "pnpm install --frozen-lockfile",
    "pnpm --filter @mistle/sandbox-runtime build:sea",
  ].join(" && ");
}

function buildToolchainSetupCommand() {
  return [
    "set -euo pipefail",
    "apt-get update",
    "apt-get install -y --no-install-recommends build-essential ca-certificates curl g++ make pkg-config python3",
    "rm -rf /var/lib/apt/lists/*",
    "curl https://sh.rustup.rs -sSf | sh -s -- -y --profile minimal --default-toolchain stable",
    "npm install -g pnpm@10.30.2",
  ].join(" && ");
}

async function main() {
  const containerPlatform = resolveContainerPlatform();
  const containerName = `mistle-sandbox-runtime-sea-build-${randomUUID()}`;

  try {
    runCommand("docker", [
      "run",
      "-d",
      "--rm",
      "--name",
      containerName,
      "--platform",
      containerPlatform,
      "-v",
      `${RepositoryRootPath}:/src:ro`,
      NodeToolchainImage,
      "sleep",
      "infinity",
    ]);

    runCommand("docker", ["exec", containerName, "bash", "-lc", buildToolchainSetupCommand()]);
    runCommand("docker", ["exec", containerName, "bash", "-lc", buildCopyCommand()]);
    runCommand("docker", ["exec", containerName, "bash", "-lc", buildSeaCommand()]);
    runCommand("rm", ["-rf", SeaOutputPath]);
    runCommand("docker", [
      "cp",
      `${containerName}:/work/apps/sandbox-runtime/dist-sea`,
      SeaOutputPath,
    ]);
  } finally {
    try {
      runCommand("docker", ["rm", "-f", containerName]);
    } catch {
      // Nothing to do if the container was already removed.
    }
  }
}

await main();
