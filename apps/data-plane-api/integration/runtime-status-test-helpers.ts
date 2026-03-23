import { spawn, type ChildProcessByStdio } from "node:child_process";
import { randomUUID } from "node:crypto";
import type { Readable } from "node:stream";
import { fileURLToPath } from "node:url";

import { mintBootstrapToken } from "@mistle/gateway-tunnel-auth";
import { systemClock, systemSleeper } from "@mistle/time";
import WebSocket from "ws";

const GatewayStartupTimeoutMs = 20_000;
const GatewayHealthPollIntervalMs = 100;
const GatewayShutdownTimeoutMs = 5_000;
const GatewayHealthcheckPath = "/__healthz";
const RepoRootPath = fileURLToPath(new URL("../../..", import.meta.url));

export const IntegrationBootstrapTokenSecret = "integration-bootstrap-token-secret";
export const IntegrationBootstrapTokenIssuer = "integration-data-plane-worker";
export const IntegrationBootstrapTokenAudience = "integration-data-plane-gateway";
export const IntegrationConnectTokenSecret = "integration-connect-token-secret";

export type StartedGatewayProcess = {
  baseUrl: string;
  websocketBaseUrl: string;
  stop: () => Promise<void>;
};

type GatewayChildProcess = ChildProcessByStdio<null, Readable, Readable>;

function createGatewayEnvironment(input: {
  port: number;
  databaseUrl: string;
  dataPlaneApiBaseUrl: string;
  internalAuthServiceToken: string;
}): NodeJS.ProcessEnv {
  const host = "127.0.0.1";
  const environment: NodeJS.ProcessEnv = {
    ...process.env,
    NODE_ENV: "development",
    MISTLE_GLOBAL_TELEMETRY_ENABLED: "false",
    MISTLE_GLOBAL_TELEMETRY_DEBUG: "false",
    MISTLE_GLOBAL_INTERNAL_AUTH_SERVICE_TOKEN: input.internalAuthServiceToken,
    MISTLE_GLOBAL_SANDBOX_PROVIDER: "docker",
    MISTLE_GLOBAL_SANDBOX_DEFAULT_BASE_IMAGE: "127.0.0.1:5001/mistle/sandbox-base:dev",
    MISTLE_GLOBAL_SANDBOX_GATEWAY_WS_URL: `ws://${host}:${String(input.port)}/tunnel/sandbox`,
    MISTLE_GLOBAL_SANDBOX_INTERNAL_GATEWAY_WS_URL: `ws://${host}:${String(input.port)}/tunnel/sandbox`,
    MISTLE_GLOBAL_SANDBOX_CONNECT_TOKEN_SECRET: IntegrationConnectTokenSecret,
    MISTLE_GLOBAL_SANDBOX_CONNECT_TOKEN_ISSUER: "integration-control-plane-api",
    MISTLE_GLOBAL_SANDBOX_CONNECT_TOKEN_AUDIENCE: IntegrationBootstrapTokenAudience,
    MISTLE_GLOBAL_SANDBOX_BOOTSTRAP_TOKEN_SECRET: IntegrationBootstrapTokenSecret,
    MISTLE_GLOBAL_SANDBOX_BOOTSTRAP_TOKEN_ISSUER: IntegrationBootstrapTokenIssuer,
    MISTLE_GLOBAL_SANDBOX_BOOTSTRAP_TOKEN_AUDIENCE: IntegrationBootstrapTokenAudience,
    MISTLE_APPS_DATA_PLANE_GATEWAY_HOST: host,
    MISTLE_APPS_DATA_PLANE_GATEWAY_PORT: String(input.port),
    MISTLE_APPS_DATA_PLANE_GATEWAY_DATABASE_URL: input.databaseUrl,
    MISTLE_APPS_DATA_PLANE_GATEWAY_RUNTIME_STATE_BACKEND: "memory",
    MISTLE_APPS_DATA_PLANE_GATEWAY_DATA_PLANE_API_BASE_URL: input.dataPlaneApiBaseUrl,
    NO_COLOR: "1",
  };

  delete environment.MISTLE_CONFIG_PATH;
  return environment;
}

function startGatewayChildProcess(input: {
  port: number;
  databaseUrl: string;
  dataPlaneApiBaseUrl: string;
  internalAuthServiceToken: string;
}): GatewayChildProcess {
  return spawn("pnpm", ["exec", "tsx", "apps/data-plane-gateway/src/index.ts"], {
    cwd: RepoRootPath,
    env: createGatewayEnvironment(input),
    stdio: ["ignore", "pipe", "pipe"],
  });
}

async function waitForGatewayHealth(input: {
  childProcess: GatewayChildProcess;
  baseUrl: string;
  startupLogs: { stdout: string; stderr: string };
}): Promise<void> {
  const deadlineMs = systemClock.nowMs() + GatewayStartupTimeoutMs;

  while (systemClock.nowMs() < deadlineMs) {
    if (input.childProcess.exitCode !== null) {
      throw new Error(
        [
          `Gateway process exited before becoming healthy with code ${String(input.childProcess.exitCode)}.`,
          input.startupLogs.stdout.length === 0 ? null : `stdout:\n${input.startupLogs.stdout}`,
          input.startupLogs.stderr.length === 0 ? null : `stderr:\n${input.startupLogs.stderr}`,
        ]
          .filter((part) => part !== null)
          .join("\n\n"),
      );
    }

    try {
      const response = await fetch(new URL(GatewayHealthcheckPath, input.baseUrl));
      if (response.status === 200) {
        return;
      }
    } catch {}

    await systemSleeper.sleep(GatewayHealthPollIntervalMs);
  }

  throw new Error(
    [
      `Timed out waiting for gateway healthcheck at ${new URL(GatewayHealthcheckPath, input.baseUrl).toString()}.`,
      input.startupLogs.stdout.length === 0 ? null : `stdout:\n${input.startupLogs.stdout}`,
      input.startupLogs.stderr.length === 0 ? null : `stderr:\n${input.startupLogs.stderr}`,
    ]
      .filter((part) => part !== null)
      .join("\n\n"),
  );
}

async function stopGatewayChildProcess(childProcess: GatewayChildProcess): Promise<void> {
  if (childProcess.exitCode !== null) {
    return;
  }

  childProcess.kill("SIGTERM");

  const deadlineMs = systemClock.nowMs() + GatewayShutdownTimeoutMs;
  while (childProcess.exitCode === null && systemClock.nowMs() < deadlineMs) {
    await systemSleeper.sleep(50);
  }

  if (childProcess.exitCode === null) {
    childProcess.kill("SIGKILL");
  }
}

export async function startGatewayProcess(input: {
  port: number;
  databaseUrl: string;
  dataPlaneApiBaseUrl: string;
  internalAuthServiceToken: string;
}): Promise<StartedGatewayProcess> {
  const baseUrl = `http://127.0.0.1:${String(input.port)}`;
  const websocketBaseUrl = `ws://127.0.0.1:${String(input.port)}`;
  const childProcess = startGatewayChildProcess(input);
  const startupLogs = {
    stdout: "",
    stderr: "",
  };

  childProcess.stdout.setEncoding("utf8");
  childProcess.stderr.setEncoding("utf8");
  childProcess.stdout.on("data", (chunk: string) => {
    startupLogs.stdout += chunk;
  });
  childProcess.stderr.on("data", (chunk: string) => {
    startupLogs.stderr += chunk;
  });

  await waitForGatewayHealth({
    childProcess,
    baseUrl,
    startupLogs,
  });

  return {
    baseUrl,
    websocketBaseUrl,
    stop: async () => {
      await stopGatewayChildProcess(childProcess);
    },
  };
}

export async function mintValidBootstrapToken(input: {
  sandboxInstanceId: string;
}): Promise<string> {
  return mintBootstrapToken({
    config: {
      bootstrapTokenSecret: IntegrationBootstrapTokenSecret,
      tokenIssuer: IntegrationBootstrapTokenIssuer,
      tokenAudience: IntegrationBootstrapTokenAudience,
    },
    jti: randomUUID(),
    sandboxInstanceId: input.sandboxInstanceId,
    ttlSeconds: 120,
  });
}

export function connectBootstrapSocket(input: {
  websocketBaseUrl: string;
  sandboxInstanceId: string;
  token: string;
}): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const url = new URL(
      `/tunnel/sandbox/${encodeURIComponent(input.sandboxInstanceId)}?bootstrap_token=${encodeURIComponent(input.token)}`,
      input.websocketBaseUrl,
    );
    const socket = new WebSocket(url);

    socket.once("open", () => {
      resolve(socket);
    });
    socket.once("error", (error: Error) => {
      reject(error);
    });
  });
}

export async function closeWebSocket(socket: WebSocket): Promise<void> {
  if (socket.readyState === WebSocket.CLOSED) {
    return;
  }

  await new Promise<void>((resolve) => {
    socket.once("close", () => {
      resolve();
    });
    socket.close();
  });
}
