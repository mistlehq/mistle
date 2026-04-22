import { spawn, type ChildProcessByStdio } from "node:child_process";
import type { Readable } from "node:stream";
import { fileURLToPath } from "node:url";

import { SandboxStorageBackend } from "@mistle/sandbox";
import { systemClock, systemSleeper } from "@mistle/time";

const ControlPlaneApiHealthcheckPath = "/__healthz";
const ControlPlaneApiStartupTimeoutMs = 20_000;
const ControlPlaneApiShutdownTimeoutMs = 5_000;
const ControlPlaneApiHealthPollIntervalMs = 100;
const RepoRootPath = fileURLToPath(new URL("../../../../", import.meta.url));

type ControlPlaneApiChildProcess = ChildProcessByStdio<null, Readable, Readable>;

export type StartedControlPlaneApiProcess = {
  baseUrl: string;
  stop: () => Promise<void>;
};

function createControlPlaneApiEnvironment(input: {
  host: string;
  port: number;
  databaseUrl: string;
  dataPlaneApiBaseUrl: string;
  workflowNamespaceId: string;
  internalAuthServiceToken: string;
  sandboxStorageBackend: typeof SandboxStorageBackend.ARCHIL;
  commitSignBinaryPath: string;
}): NodeJS.ProcessEnv {
  return {
    ...process.env,
    NODE_ENV: "development",
    NO_COLOR: "1",
    MISTLE_GLOBAL_TELEMETRY_ENABLED: "false",
    MISTLE_GLOBAL_TELEMETRY_DEBUG: "false",
    MISTLE_TEST_CONTROL_PLANE_API_HOST: input.host,
    MISTLE_TEST_CONTROL_PLANE_API_PORT: String(input.port),
    MISTLE_TEST_CONTROL_PLANE_API_DATABASE_URL: input.databaseUrl,
    MISTLE_TEST_CONTROL_PLANE_API_DATA_PLANE_API_BASE_URL: input.dataPlaneApiBaseUrl,
    MISTLE_TEST_CONTROL_PLANE_API_WORKFLOW_NAMESPACE_ID: input.workflowNamespaceId,
    MISTLE_TEST_CONTROL_PLANE_API_INTERNAL_AUTH_SERVICE_TOKEN: input.internalAuthServiceToken,
    MISTLE_TEST_CONTROL_PLANE_API_SANDBOX_STORAGE_BACKEND: input.sandboxStorageBackend,
    MISTLE_TEST_COMMIT_SIGN_BINARY_PATH: input.commitSignBinaryPath,
  };
}

function startControlPlaneApiChildProcess(input: {
  host: string;
  port: number;
  databaseUrl: string;
  dataPlaneApiBaseUrl: string;
  workflowNamespaceId: string;
  internalAuthServiceToken: string;
  sandboxStorageBackend: typeof SandboxStorageBackend.ARCHIL;
  commitSignBinaryPath: string;
}): ControlPlaneApiChildProcess {
  return spawn(
    "pnpm",
    ["exec", "tsx", "apps/data-plane-api/integration/helpers/start-control-plane-api.ts"],
    {
      cwd: RepoRootPath,
      env: createControlPlaneApiEnvironment(input),
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
}

async function waitForControlPlaneApiHealth(input: {
  childProcess: ControlPlaneApiChildProcess;
  baseUrl: string;
  startupLogs: { stdout: string; stderr: string };
}): Promise<void> {
  const deadline = systemClock.nowMs() + ControlPlaneApiStartupTimeoutMs;

  while (systemClock.nowMs() < deadline) {
    if (input.childProcess.exitCode !== null) {
      throw new Error(
        `control-plane-api exited before becoming healthy (code=${String(input.childProcess.exitCode)}).\nstdout:\n${input.startupLogs.stdout}\nstderr:\n${input.startupLogs.stderr}`,
      );
    }

    try {
      const response = await fetch(`${input.baseUrl}${ControlPlaneApiHealthcheckPath}`);
      if (response.ok) {
        return;
      }
    } catch {}

    await systemSleeper.sleep(ControlPlaneApiHealthPollIntervalMs);
  }

  throw new Error(
    `Timed out waiting for control-plane-api health.\nstdout:\n${input.startupLogs.stdout}\nstderr:\n${input.startupLogs.stderr}`,
  );
}

export async function startControlPlaneApiProcess(input: {
  host: string;
  port: number;
  databaseUrl: string;
  dataPlaneApiBaseUrl: string;
  workflowNamespaceId: string;
  internalAuthServiceToken: string;
  sandboxStorageBackend: typeof SandboxStorageBackend.ARCHIL;
  commitSignBinaryPath: string;
}): Promise<StartedControlPlaneApiProcess> {
  const childProcess = startControlPlaneApiChildProcess(input);
  const stdoutChunks: string[] = [];
  const stderrChunks: string[] = [];

  childProcess.stdout.setEncoding("utf8");
  childProcess.stderr.setEncoding("utf8");
  childProcess.stdout.on("data", (chunk: string) => {
    stdoutChunks.push(chunk);
  });
  childProcess.stderr.on("data", (chunk: string) => {
    stderrChunks.push(chunk);
  });

  const baseUrl = `http://${input.host}:${String(input.port)}`;
  await waitForControlPlaneApiHealth({
    childProcess,
    baseUrl,
    startupLogs: {
      stdout: stdoutChunks.join(""),
      stderr: stderrChunks.join(""),
    },
  });

  return {
    baseUrl,
    stop: async () => {
      if (childProcess.exitCode !== null) {
        return;
      }

      childProcess.kill("SIGTERM");
      const shutdownDeadline = systemClock.nowMs() + ControlPlaneApiShutdownTimeoutMs;
      while (childProcess.exitCode === null && systemClock.nowMs() < shutdownDeadline) {
        await systemSleeper.sleep(50);
      }

      if (childProcess.exitCode === null) {
        childProcess.kill("SIGKILL");
      }
    },
  };
}
