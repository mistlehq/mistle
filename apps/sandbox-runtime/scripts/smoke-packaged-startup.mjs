import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { constants as FsConstants } from "node:fs";
import { access } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ScriptDirectoryPath = dirname(fileURLToPath(import.meta.url));
const AppRootPath = resolve(ScriptDirectoryPath, "..");
const RepositoryRootPath = resolve(AppRootPath, "../..");
const SeaOutputDirectoryPath = resolve(AppRootPath, "dist-sea");
const DockerImageTag = `mistle-sandbox-runtime-packaged-startup:${randomUUID()}`;
const ContainerName = `mistle-sandbox-runtime-packaged-startup-${randomUUID()}`;
const StartupTokenPath = "/run/mistle/startup-config.token";
const ApplyStartupPayload = JSON.stringify({
  bootstrapToken: "test-bootstrap-token",
  tunnelExchangeToken: "test-exchange-token",
  tunnelGatewayWsUrl: "ws://example.test/tunnel/sandbox/test",
  runtimePlan: {
    sandboxProfileId: "sbp_test",
    version: 1,
    image: {
      source: "base",
      imageRef: "registry:3",
    },
    egressRoutes: [],
    artifacts: [],
    workspaceSources: [],
    runtimeClients: [],
    agentRuntimes: [],
  },
});

function runCommand(command, args, cwd = RepositoryRootPath) {
  return execFileSync(command, args, {
    cwd,
    encoding: "utf8",
    stdio: "pipe",
  });
}

async function ensureSeaOutputExists() {
  await access(resolve(SeaOutputDirectoryPath, "sandboxd"), FsConstants.X_OK);
  await access(resolve(SeaOutputDirectoryPath, "sandbox-bootstrap"), FsConstants.X_OK);
}

function buildSandboxImage() {
  runCommand("docker", [
    "build",
    "--target",
    "sandbox-base",
    "-f",
    resolve(AppRootPath, "Dockerfile"),
    "-t",
    DockerImageTag,
    RepositoryRootPath,
  ]);
}

function startSandboxContainer() {
  const containerId = runCommand("docker", [
    "run",
    "-d",
    "--rm",
    "--name",
    ContainerName,
    DockerImageTag,
  ]).trim();

  if (containerId.length === 0) {
    throw new Error("Failed to start packaged sandbox runtime container.");
  }
}

const SleepBuffer = new Int32Array(new SharedArrayBuffer(4));

function sleep(milliseconds) {
  Atomics.wait(SleepBuffer, 0, 0, milliseconds);
}

async function waitForStartupToken() {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    try {
      const token = runCommand("docker", ["exec", ContainerName, "cat", StartupTokenPath]).trim();
      if (token.length > 0) {
        return;
      }
    } catch {
      // The supervisor may still be creating the token file.
    }

    sleep(100);
  }

  throw new Error("Timed out waiting for packaged sandbox runtime startup token.");
}

function assertStartupTokenConsumed() {
  try {
    runCommand("docker", ["exec", ContainerName, "test", "-f", StartupTokenPath]);
  } catch {
    return;
  }

  throw new Error("Expected startup token to be consumed after packaged startup apply.");
}

function cleanupContainer() {
  try {
    runCommand("docker", ["rm", "-f", ContainerName]);
  } catch {
    // Container may already be gone.
  }
}

function cleanupImage() {
  try {
    runCommand("docker", ["image", "rm", "-f", DockerImageTag]);
  } catch {
    // Image cleanup is best effort only.
  }
}

async function main() {
  await ensureSeaOutputExists();
  buildSandboxImage();

  try {
    startSandboxContainer();
    await waitForStartupToken();

    execFileSync(
      "docker",
      ["exec", "-i", ContainerName, "/usr/local/bin/sandboxd", "apply-startup"],
      {
        cwd: RepositoryRootPath,
        encoding: "utf8",
        input: `${ApplyStartupPayload}\n`,
        stdio: ["pipe", "pipe", "pipe"],
      },
    );

    assertStartupTokenConsumed();
  } finally {
    cleanupContainer();
    cleanupImage();
  }
}

await main();
