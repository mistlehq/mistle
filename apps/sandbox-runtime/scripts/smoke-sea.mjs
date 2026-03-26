import { spawn } from "node:child_process";
import { access, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const AppRootPath = resolve(fileURLToPath(new URL("..", import.meta.url)));
const SeaOutputDirectoryPath = resolve(AppRootPath, "dist-sea");
const RuntimeBinaryPath = resolve(SeaOutputDirectoryPath, "sandboxd");
const TokenizerProxyEgressBaseUrl = "http://127.0.0.1:8091/tokenizer-proxy/egress";
const ControlDirectoryName = "control";
const StartupSocketFileName = "startup-config.sock";
const StartupTokenFileName = "startup-config.token";
const SleepBuffer = new Int32Array(new SharedArrayBuffer(4));

function createStartupInputJson() {
  return JSON.stringify({
    bootstrapToken: "test-token",
    tunnelExchangeToken: "test-exchange-token",
    tunnelGatewayWsUrl: "ws://127.0.0.1:5003/tunnel/sandbox",
    egressGrantByRuleId: {},
    runtimePlan: {
      sandboxProfileId: "sbp_test",
      version: 1,
      image: {
        source: "base",
        imageRef: "mistle/sandbox-base:dev",
      },
      egressRoutes: [],
      artifacts: [],
      runtimeClients: [
        {
          clientId: "client_codex",
          setup: {
            env: {},
            files: [],
          },
          processes: [
            {
              processKey: "process_codex_server",
              command: {
                args: ["/definitely/missing/binary"],
                env: {},
              },
              readiness: {
                type: "none",
              },
              stop: {
                signal: "sigterm",
                timeoutMs: 1000,
                gracePeriodMs: 100,
              },
            },
          ],
          endpoints: [],
        },
      ],
      workspaceSources: [],
      agentRuntimes: [],
    },
  });
}

function sleep(milliseconds) {
  Atomics.wait(SleepBuffer, 0, 0, milliseconds);
}

function waitForExit(child) {
  return new Promise((resolveExitCode, reject) => {
    child.once("error", reject);
    child.once("exit", (code) => {
      resolveExitCode(code);
    });
  });
}

async function waitForFile(filePath) {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    try {
      await access(filePath);
      return;
    } catch {
      sleep(100);
    }
  }

  throw new Error(`Timed out waiting for ${filePath}.`);
}

async function runRuntimeInternalSmoke(smokeDirectoryPath, startupInputJson) {
  const stderrChunks = [];
  const child = spawn(RuntimeBinaryPath, ["runtime-internal"], {
    cwd: smokeDirectoryPath,
    env: {
      ...process.env,
      SANDBOX_RUNTIME_LISTEN_ADDR: ":0",
      SANDBOX_RUNTIME_TOKENIZER_PROXY_EGRESS_BASE_URL: TokenizerProxyEgressBaseUrl,
    },
    stdio: ["pipe", "ignore", "pipe"],
  });
  const childExit = waitForExit(child);

  child.stdin.end(startupInputJson);
  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (chunk) => {
    stderrChunks.push(chunk);
  });

  const exitCode = await childExit;
  const stderr = stderrChunks.join("");
  const expectedError =
    "sandbox runtime exited with error: failed to start runtime client processes";

  if (exitCode !== 1 || !stderr.includes(expectedError)) {
    throw new Error(
      `SEA runtime-internal smoke test failed (exitCode=${String(exitCode)} stderr=${JSON.stringify(stderr)})`,
    );
  }
}

async function runSupervisorApplyStartupSmoke(smokeDirectoryPath, startupInputJson) {
  const controlDirectoryPath = join(smokeDirectoryPath, ControlDirectoryName);
  const startupTokenPath = join(controlDirectoryPath, StartupTokenFileName);
  const startupSocketPath = join(controlDirectoryPath, StartupSocketFileName);
  const serveChild = spawn(RuntimeBinaryPath, ["serve"], {
    cwd: smokeDirectoryPath,
    env: {
      ...process.env,
      SANDBOX_RUNTIME_CONTROL_DIR: controlDirectoryPath,
      SANDBOX_RUNTIME_LISTEN_ADDR: ":0",
      SANDBOX_RUNTIME_TOKENIZER_PROXY_EGRESS_BASE_URL: TokenizerProxyEgressBaseUrl,
    },
    stdio: ["ignore", "ignore", "pipe"],
  });
  const serveChildExit = waitForExit(serveChild);

  try {
    await waitForFile(startupTokenPath);
    await waitForFile(startupSocketPath);

    const applyStartupStderrChunks = [];
    const applyStartupChild = spawn(RuntimeBinaryPath, ["apply-startup"], {
      cwd: smokeDirectoryPath,
      env: {
        ...process.env,
        SANDBOX_RUNTIME_CONTROL_DIR: controlDirectoryPath,
      },
      stdio: ["pipe", "ignore", "pipe"],
    });
    const applyStartupChildExit = waitForExit(applyStartupChild);

    applyStartupChild.stdin.end(startupInputJson);
    applyStartupChild.stderr.setEncoding("utf8");
    applyStartupChild.stderr.on("data", (chunk) => {
      applyStartupStderrChunks.push(chunk);
    });

    const applyStartupExitCode = await applyStartupChildExit;
    const applyStartupStderr = applyStartupStderrChunks.join("");
    if (applyStartupExitCode !== 0) {
      throw new Error(
        `SEA apply-startup smoke test failed (exitCode=${String(applyStartupExitCode)} stderr=${JSON.stringify(applyStartupStderr)})`,
      );
    }

    for (let attempt = 0; attempt < 50; attempt += 1) {
      try {
        await access(startupTokenPath);
      } catch {
        return;
      }

      sleep(100);
    }

    throw new Error("SEA apply-startup smoke test expected startup token to be consumed.");
  } finally {
    serveChild.kill("SIGTERM");
    await serveChildExit;
  }
}

async function runSmokeTest() {
  const smokeDirectoryPath = await mkdtemp(join(tmpdir(), "mistle-sea-smoke-"));

  try {
    const startupInputJson = createStartupInputJson();
    await runRuntimeInternalSmoke(smokeDirectoryPath, startupInputJson);
    await runSupervisorApplyStartupSmoke(smokeDirectoryPath, startupInputJson);
  } finally {
    await rm(smokeDirectoryPath, { recursive: true, force: true });
  }
}

await runSmokeTest();
