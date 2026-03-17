import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ScriptDirectoryPath = dirname(fileURLToPath(import.meta.url));
const RepositoryRootPath = resolve(ScriptDirectoryPath, "../..");
const DockerContextPath = resolve(RepositoryRootPath, "docker/sandbox-runtime-sea-check");
const DockerImageTag = "mistle-sandbox-runtime-sea-check:local";
const ContainerPlatform = process.env.MISTLE_SANDBOX_RUNTIME_SEA_CHECK_PLATFORM ?? "linux/amd64";

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
    "--exclude=apps/sandbox-runtime-node/dist-sea",
    "-cf",
    "-",
    ".",
  ].join(" ");

  return `set -euo pipefail && mkdir -p /work && cd /src && ${tarCommand} | tar -xf - -C /work`;
}

function buildTestCommand() {
  return [
    "set -euo pipefail",
    "cd /work",
    "pnpm install --frozen-lockfile",
    "pnpm --filter @mistle/sandbox-runtime-node test:sea",
  ].join(" && ");
}

async function main() {
  const containerName = `mistle-sandbox-runtime-sea-${randomUUID()}`;

  runCommand("docker", [
    "build",
    "--platform",
    ContainerPlatform,
    "-t",
    DockerImageTag,
    DockerContextPath,
  ]);

  try {
    runCommand("docker", [
      "run",
      "-d",
      "--rm",
      "--name",
      containerName,
      "--platform",
      ContainerPlatform,
      "-v",
      `${RepositoryRootPath}:/src:ro`,
      DockerImageTag,
      "sleep",
      "infinity",
    ]);

    runCommand("docker", ["exec", containerName, "bash", "-lc", buildCopyCommand()]);
    runCommand("docker", ["exec", containerName, "bash", "-lc", buildTestCommand()]);
  } finally {
    try {
      runCommand("docker", ["rm", "-f", containerName]);
    } catch {
      // Nothing to do if the container was already removed.
    }
  }
}

await main();
