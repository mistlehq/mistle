import { execFileSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// This packaging check verifies that the sandbox base Docker image still builds
// successfully for the Linux platform used in CI and release automation.

const ScriptDirectoryPath = dirname(fileURLToPath(import.meta.url));
const RepositoryRootPath = resolve(ScriptDirectoryPath, "../..");
const DockerfilePath = resolve(RepositoryRootPath, "packages/sandboxd/Dockerfile");
const DockerImageTag = "mistle-sandbox-base-check:local";
const ContainerPlatform = process.env.MISTLE_SANDBOX_BASE_CHECK_PLATFORM ?? "linux/amd64";

function runCommand(command, args, cwd = RepositoryRootPath) {
  execFileSync(command, args, {
    cwd,
    stdio: "inherit",
  });
}

function main() {
  runCommand("docker", [
    "build",
    "--platform",
    ContainerPlatform,
    "--target",
    "sandbox-base",
    "-t",
    DockerImageTag,
    "-f",
    DockerfilePath,
    ".",
  ]);
}

main();
