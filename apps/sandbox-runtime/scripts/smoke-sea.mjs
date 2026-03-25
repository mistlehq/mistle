import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const AppRootPath = resolve(fileURLToPath(new URL("..", import.meta.url)));
const SeaOutputDirectoryPath = resolve(AppRootPath, "dist-sea");
const RuntimeBinaryPath = resolve(SeaOutputDirectoryPath, "sandboxd");

function createStartupInputJson() {
  return JSON.stringify({
    bootstrapToken: "test-token",
    tunnelExchangeToken: "test-exchange-token",
    tunnelGatewayWsUrl: "ws://127.0.0.1:5003/tunnel/sandbox",
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

async function runSmokeTest() {
  const smokeDirectoryPath = await mkdtemp(join(tmpdir(), "mistle-sea-smoke-"));

  try {
    const stderrChunks = [];
    const startupInputJson = createStartupInputJson();
    const child = spawn(RuntimeBinaryPath, ["runtime-internal"], {
      cwd: smokeDirectoryPath,
      env: {
        ...process.env,
        SANDBOX_RUNTIME_LISTEN_ADDR: ":0",
        SANDBOX_RUNTIME_TOKENIZER_PROXY_EGRESS_BASE_URL:
          "http://127.0.0.1:8091/tokenizer-proxy/egress",
      },
      stdio: ["pipe", "ignore", "pipe"],
    });

    child.stdin.end(startupInputJson);
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk) => {
      stderrChunks.push(chunk);
    });

    const exitCode = await new Promise((resolveExitCode, reject) => {
      child.once("error", reject);
      child.once("exit", (code) => {
        resolveExitCode(code);
      });
    });

    const stderr = stderrChunks.join("");
    if (
      exitCode !== 1 ||
      !stderr.includes(
        "sandbox runtime exited with error: failed to start runtime client processes",
      )
    ) {
      throw new Error(
        `SEA runtime smoke test failed (exitCode=${String(exitCode)} stderr=${JSON.stringify(stderr)})`,
      );
    }
  } finally {
    await rm(smokeDirectoryPath, { recursive: true, force: true });
  }
}

await runSmokeTest();
