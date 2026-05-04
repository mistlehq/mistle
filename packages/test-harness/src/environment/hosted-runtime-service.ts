import { spawn } from "node:child_process";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

import { systemClock, systemSleeper } from "@mistle/time";

import {
  acquireRunnerServicePoolLease,
  type RunnerServicePoolLease,
} from "./runner-service-pool.js";
import type { TestServiceRuntime } from "./types.js";

const StartupPollIntervalMs = 25;
const StartupTimeoutMs = 10_000;

export type HostedRuntimeServiceInput = {
  runId: string;
  coordinatorDir: string;
  key: string;
  modulePath: string;
  exportName: string;
  healthCheckPath: string;
  host?: string;
};

export async function acquireHostedRuntimeService(
  input: HostedRuntimeServiceInput,
): Promise<RunnerServicePoolLease> {
  return acquireRunnerServicePoolLease({
    runId: input.runId,
    coordinatorDir: input.coordinatorDir,
    key: input.key,
    healthCheck: async (service) => {
      const httpEndpoint = readHttpEndpoint(service, `hosted runtime service '${input.key}'`);
      const response = await fetch(new URL(input.healthCheckPath, httpEndpoint.hostBaseUrl));
      if (!response.ok) {
        throw new Error(
          `Hosted runtime service '${input.key}' health check returned ${String(response.status)}.`,
        );
      }
    },
    start: async () => startHostedRuntimeProcess(input),
  });
}

async function startHostedRuntimeProcess(input: HostedRuntimeServiceInput): Promise<{
  endpoints: {
    http: {
      hostBaseUrl: string;
    };
  };
  pid: number;
  stop: () => Promise<void>;
}> {
  validateExportName(input.exportName);

  const runtimeDirectoryPath = await createRuntimeDirectory(input);
  const startupFilePath = join(runtimeDirectoryPath, "startup.json");
  const entrypointPath = join(runtimeDirectoryPath, "hosted-runtime-entrypoint.mjs");
  await writeFile(entrypointPath, createHostedRuntimeEntrypoint(input), "utf8");

  const child = spawn(process.execPath, ["--import", "tsx", entrypointPath], {
    detached: true,
    env: {
      ...process.env,
      MISTLE_HOSTED_RUNTIME_STARTUP_FILE: startupFilePath,
      MISTLE_HOSTED_RUNTIME_HOST: input.host ?? "127.0.0.1",
      MISTLE_HOSTED_RUNTIME_PORT: "0",
    },
    stdio: "ignore",
  });
  child.unref();

  const startup = await readStartupFile(startupFilePath);

  return {
    endpoints: {
      http: {
        hostBaseUrl: startup.hostBaseUrl,
      },
    },
    pid: startup.pid,
    stop: async () => {
      if (isProcessAlive(startup.pid)) {
        process.kill(startup.pid, "SIGTERM");
      }
      await rm(runtimeDirectoryPath, {
        force: true,
        recursive: true,
      });
    },
  };
}

function readHttpEndpoint(
  service: TestServiceRuntime,
  label: string,
): {
  hostBaseUrl: string;
} {
  const httpEndpoint = service.endpoints.http;
  if (httpEndpoint === undefined) {
    throw new Error(`Expected ${label} to expose an HTTP endpoint.`);
  }

  return httpEndpoint;
}

async function createRuntimeDirectory(input: HostedRuntimeServiceInput): Promise<string> {
  const runtimeRootDirectoryPath = join(input.coordinatorDir, input.runId, "hosted-runtime");
  await mkdir(runtimeRootDirectoryPath, {
    recursive: true,
  });
  const runtimeDirectoryPath = join(runtimeRootDirectoryPath, encodeURIComponent(input.key));
  await mkdir(runtimeDirectoryPath, {
    recursive: true,
  });
  return runtimeDirectoryPath;
}

function createHostedRuntimeEntrypoint(input: HostedRuntimeServiceInput): string {
  const moduleUrl = pathToFileURL(input.modulePath).href;

  return `
import { writeFile } from "node:fs/promises";
import { ${input.exportName} as startHostedRuntime } from "${moduleUrl}";

const startupFilePath = readEnv("MISTLE_HOSTED_RUNTIME_STARTUP_FILE");
const host = readEnv("MISTLE_HOSTED_RUNTIME_HOST");
const port = Number(readEnv("MISTLE_HOSTED_RUNTIME_PORT"));

const startedRuntime = await startHostedRuntime({ host, port });
if (
  typeof startedRuntime !== "object" ||
  startedRuntime === null ||
  typeof startedRuntime.hostBaseUrl !== "string" ||
  typeof startedRuntime.stop !== "function"
) {
  throw new Error("Hosted runtime export must return { hostBaseUrl, stop }.");
}

await writeFile(startupFilePath, JSON.stringify({
  hostBaseUrl: startedRuntime.hostBaseUrl,
  pid: process.pid,
}) + "\\n", "utf8");

async function stopAndExit() {
  await startedRuntime.stop();
  process.exit(0);
}

process.once("SIGTERM", () => {
  void stopAndExit();
});

process.once("SIGINT", () => {
  void stopAndExit();
});

function readEnv(name) {
  const value = process.env[name];
  if (value === undefined || value.length === 0) {
    throw new Error(\`Missing required environment variable \${name}.\`);
  }
  return value;
}
`;
}

async function readStartupFile(startupFilePath: string): Promise<{
  hostBaseUrl: string;
  pid: number;
}> {
  const deadline = systemClock.nowMs() + StartupTimeoutMs;

  while (systemClock.nowMs() < deadline) {
    try {
      const raw = await readFile(startupFilePath, "utf8");
      return parseStartupPayload(raw);
    } catch (error) {
      if (!isNodeErrorCode(error, "ENOENT")) {
        throw error;
      }

      await systemSleeper.sleep(StartupPollIntervalMs);
    }
  }

  throw new Error(`Timed out waiting for hosted runtime startup file '${startupFilePath}'.`);
}

function parseStartupPayload(raw: string): {
  hostBaseUrl: string;
  pid: number;
} {
  const parsed: unknown = JSON.parse(raw);
  if (!isRecord(parsed)) {
    throw new Error("Hosted runtime startup payload must be an object.");
  }

  const hostBaseUrl = parsed["hostBaseUrl"];
  const pid = parsed["pid"];
  if (typeof hostBaseUrl !== "string" || typeof pid !== "number") {
    throw new Error("Hosted runtime startup payload must include hostBaseUrl and pid.");
  }

  return {
    hostBaseUrl,
    pid,
  };
}

function validateExportName(exportName: string): void {
  if (!/^[A-Za-z_$][A-Za-z0-9_$]*$/u.test(exportName)) {
    throw new Error(`Invalid hosted runtime export name '${exportName}'.`);
  }
}

function isProcessAlive(processId: number): boolean {
  try {
    process.kill(processId, 0);
    return true;
  } catch (error) {
    if (!isRecord(error)) {
      return false;
    }
    const code = error["code"];
    if (code === "ESRCH") {
      return false;
    }
    if (code === "EPERM") {
      return true;
    }
    return false;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isNodeErrorCode(error: unknown, code: string): boolean {
  return isRecord(error) && error["code"] === code;
}
