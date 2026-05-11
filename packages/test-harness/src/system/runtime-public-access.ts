import { spawn } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { connect as connectTls } from "node:tls";

import { systemScheduler, systemSleeper } from "@mistle/time";

import { resolveRunnerPoolSession } from "../environment/runner-pool-session.js";
import { acquireRunnerServicePoolLease } from "../environment/runner-service-pool.js";
import type { TestServiceRuntime } from "../environment/types.js";
import { releaseReservedPort, reserveAvailablePort } from "../network/reserve-available-port.js";
import { parseCloudflaredTunnelCredentialsJson } from "./cloudflared-config.js";

const CloudflaredImageReference = "cloudflare/cloudflared:latest";
const CloudflaredTunnelPollIntervalMs = 500;
const CloudflaredTunnelStartupTimeoutMs = 180_000;
const RuntimePublicAccessTunnelLabel = "mistle.runtime-public-access.tunnel-id";
const RuntimePublicAccessProxyHost = "0.0.0.0";
const RuntimePublicAccessProxyExitTimeoutMs = 10_000;
const RuntimePublicAccessProxyReadyTimeoutMs = 30_000;
const RuntimePublicAccessProxyPoolLockTimeoutMs = 240_000;
const RuntimePublicAccessRouteReadyTimeoutMs = 30_000;
const RuntimePublicAccessUpgradeProbeTimeoutMs = 5_000;

export type RuntimePublicAccessTunnel = {
  publicBaseUrls: ReadonlyMap<string, string>;
  checkReady: (input?: RuntimePublicAccessReadinessCheckInput) => Promise<void>;
  readDiagnostics: () => Promise<unknown>;
  stop: () => Promise<void>;
};

export type RuntimePublicAccessReadinessCheckInput = {
  timeoutMs?: number;
};

export type RuntimePublicAccessIngressRule = {
  publicHostname: string;
  localBaseUrl: string;
  upgradeProbePath?: string;
};

export async function startRuntimeCloudflaredTunnel(input: {
  environmentId: string;
  tunnelId: string;
  tunnelCredentialsJson: string;
  publicHostnames: readonly string[];
  ingressRules: readonly RuntimePublicAccessIngressRule[];
}): Promise<RuntimePublicAccessTunnel> {
  if (input.ingressRules.length === 0) {
    throw new Error("Runtime Cloudflare public access requires at least one ingress rule.");
  }

  const publicBaseUrls = new Map(
    input.ingressRules.map((rule) => [rule.publicHostname, `https://${rule.publicHostname}`]),
  );
  parseCloudflaredTunnelCredentialsJson({
    tunnelId: input.tunnelId,
    credentialsJson: input.tunnelCredentialsJson,
  });
  const proxy = await acquireRuntimePublicAccessProxy({
    tunnelId: input.tunnelId,
    tunnelCredentialsJson: input.tunnelCredentialsJson,
    publicHostnames: input.publicHostnames,
  });
  const registered = await registerRuntimePublicAccessRoutes({
    proxy,
    environmentId: input.environmentId,
    ingressRules: input.ingressRules,
  });
  await waitForRuntimePublicAccessRoutesReady({
    proxy,
    environmentId: input.environmentId,
    ingressRules: input.ingressRules,
    timeoutMs: RuntimePublicAccessRouteReadyTimeoutMs,
  });

  return {
    publicBaseUrls,
    checkReady: async (checkInput = {}) => {
      await waitForRuntimePublicAccessRoutesReady({
        proxy,
        environmentId: input.environmentId,
        ingressRules: input.ingressRules,
        timeoutMs: checkInput.timeoutMs ?? RuntimePublicAccessRouteReadyTimeoutMs,
      });
    },
    readDiagnostics: async () => readRuntimePublicAccessProxyDiagnostics(proxy),
    stop: async () => {
      if (registered) {
        await unregisterRuntimePublicAccessRoutes({
          proxy,
          environmentId: input.environmentId,
        });
      }
      await proxy.release();
    },
  };
}

type RuntimePublicAccessProxy = TestServiceRuntime & {
  release: () => Promise<void>;
};

async function acquireRuntimePublicAccessProxy(input: {
  tunnelId: string;
  tunnelCredentialsJson: string;
  publicHostnames: readonly string[];
}): Promise<RuntimePublicAccessProxy> {
  const runnerPoolSession = resolveRunnerPoolSession(process.env);
  const publicHostnames = normalizeRuntimePublicAccessHostnames(input.publicHostnames);
  const proxy = await acquireRunnerServicePoolLease({
    runId: runnerPoolSession.runId,
    coordinatorDir: runnerPoolSession.coordinatorDir,
    key: createRuntimePublicAccessProxyPoolKey({ tunnelId: input.tunnelId }),
    lockTimeoutMs: RuntimePublicAccessProxyPoolLockTimeoutMs,
    start: async () =>
      startRuntimePublicAccessProxy({
        tunnelId: input.tunnelId,
        tunnelCredentialsJson: input.tunnelCredentialsJson,
        publicHostnames,
        coordinatorDir: runnerPoolSession.coordinatorDir,
        ownerPid: runnerPoolSession.ownerPid,
      }),
    healthCheck: async (service) => {
      const endpoint = service.endpoints.http;
      if (endpoint === undefined) {
        throw new Error("Runtime public access proxy did not expose an HTTP endpoint.");
      }

      const response = await fetch(new URL("/__healthz", endpoint.hostBaseUrl));
      if (!response.ok) {
        throw new Error(
          `Runtime public access proxy health check failed with status ${String(response.status)}.`,
        );
      }

      for (const publicHostname of publicHostnames) {
        await waitForCloudflaredHealth({
          publicBaseUrl: `https://${publicHostname}`,
          timeoutMs: CloudflaredTunnelStartupTimeoutMs,
        });
      }
    },
  });

  return proxy;
}

export function createRuntimePublicAccessProxyPoolKey(input: { tunnelId: string }): string {
  return `runtime-public-access:${input.tunnelId}`;
}

export function normalizeRuntimePublicAccessHostnames(
  publicHostnames: readonly string[],
): readonly string[] {
  const normalized = [...new Set(publicHostnames)].sort();
  if (normalized.length === 0 || normalized.some((publicHostname) => publicHostname.length === 0)) {
    throw new Error("Runtime public access proxy requires at least one public hostname.");
  }

  return normalized;
}

async function startRuntimePublicAccessProxy(input: {
  tunnelId: string;
  tunnelCredentialsJson: string;
  publicHostnames: readonly string[];
  coordinatorDir: string;
  ownerPid: number;
}): Promise<{
  endpoints: {
    http: {
      hostBaseUrl: string;
    };
  };
  pid: number;
  stop: () => Promise<void>;
}> {
  const workDirectoryPath = await mkdtemp(
    join(input.coordinatorDir, "runtime-public-access-proxy-"),
  );
  await mkdir(workDirectoryPath, { recursive: true });
  const scriptPath = join(workDirectoryPath, "proxy.mjs");
  const readyPath = join(workDirectoryPath, "ready.json");
  const logPath = join(workDirectoryPath, "proxy.log");
  await writeFile(scriptPath, createRuntimePublicAccessProxyScript(), "utf8");
  const proxyPort = await reserveAvailablePort({
    host: RuntimePublicAccessProxyHost,
    coordinatorDir: input.coordinatorDir,
  });

  const child = spawn(process.execPath, [scriptPath], {
    detached: false,
    stdio: ["ignore", "ignore", "ignore"],
    env: {
      ...process.env,
      MISTLE_RUNTIME_PUBLIC_ACCESS_TUNNEL_ID: input.tunnelId,
      MISTLE_RUNTIME_PUBLIC_ACCESS_TUNNEL_CREDENTIALS_JSON: input.tunnelCredentialsJson,
      MISTLE_RUNTIME_PUBLIC_ACCESS_PUBLIC_HOSTNAMES: JSON.stringify(input.publicHostnames),
      MISTLE_RUNTIME_PUBLIC_ACCESS_OWNER_PID: String(input.ownerPid),
      MISTLE_RUNTIME_PUBLIC_ACCESS_READY_PATH: readyPath,
      MISTLE_RUNTIME_PUBLIC_ACCESS_LOG_PATH: logPath,
      MISTLE_RUNTIME_PUBLIC_ACCESS_PROXY_PORT: String(proxyPort),
      MISTLE_RUNTIME_PUBLIC_ACCESS_CLOUDFLARED_IMAGE: CloudflaredImageReference,
      MISTLE_RUNTIME_PUBLIC_ACCESS_TUNNEL_LABEL: RuntimePublicAccessTunnelLabel,
    },
  });
  if (child.pid === undefined) {
    await releaseReservedPort({
      host: RuntimePublicAccessProxyHost,
      port: proxyPort,
      coordinatorDir: input.coordinatorDir,
    });
    throw new Error("Failed to start runtime public access proxy process.");
  }

  try {
    const ready = await waitForRuntimePublicAccessProxyReady({
      readyPath,
      timeoutMs: RuntimePublicAccessProxyReadyTimeoutMs,
    });

    for (const publicHostname of input.publicHostnames) {
      await waitForCloudflaredHealth({
        publicBaseUrl: `https://${publicHostname}`,
        timeoutMs: CloudflaredTunnelStartupTimeoutMs,
      });
    }

    return {
      endpoints: {
        http: {
          hostBaseUrl: ready.baseUrl,
        },
      },
      pid: child.pid,
      stop: async () => {
        try {
          child.kill("SIGTERM");
          await waitForRuntimePublicAccessProxyExit(child);
          await rm(workDirectoryPath, { recursive: true, force: true });
        } finally {
          await releaseReservedPort({
            host: RuntimePublicAccessProxyHost,
            port: proxyPort,
            coordinatorDir: input.coordinatorDir,
          });
        }
      },
    };
  } catch (error) {
    try {
      child.kill("SIGTERM");
      await waitForRuntimePublicAccessProxyExit(child);
    } finally {
      await releaseReservedPort({
        host: RuntimePublicAccessProxyHost,
        port: proxyPort,
        coordinatorDir: input.coordinatorDir,
      });
    }
    const logs = await readFile(logPath, "utf8").catch(() => "");
    await rm(workDirectoryPath, { recursive: true, force: true });
    throw new Error(
      `Failed to start runtime public access proxy. ${
        error instanceof Error ? error.message : String(error)
      } Logs: ${logs}`,
    );
  }
}

function waitForRuntimePublicAccessProxyExit(child: ReturnType<typeof spawn>): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) {
    return Promise.resolve();
  }

  return new Promise((resolve, reject) => {
    const timeout = systemScheduler.schedule(() => {
      reject(new Error("Timed out waiting for runtime public access proxy process to exit."));
    }, RuntimePublicAccessProxyExitTimeoutMs);
    child.once("exit", () => {
      systemScheduler.cancel(timeout);
      resolve();
    });
  });
}

async function waitForRuntimePublicAccessProxyReady(input: {
  readyPath: string;
  timeoutMs: number;
}): Promise<{ baseUrl: string }> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < input.timeoutMs) {
    const ready = await readRuntimePublicAccessProxyReady(input.readyPath);
    if (ready !== undefined) {
      return ready;
    }
    await systemSleeper.sleep(CloudflaredTunnelPollIntervalMs);
  }

  throw new Error(
    `Timed out waiting for runtime public access proxy ready file '${input.readyPath}'.`,
  );
}

async function readRuntimePublicAccessProxyReady(
  readyPath: string,
): Promise<{ baseUrl: string } | undefined> {
  let raw: string;
  try {
    raw = await readFile(readyPath, "utf8");
  } catch {
    return undefined;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new Error(`Invalid runtime public access proxy ready file '${readyPath}'.`, {
      cause: error,
    });
  }

  if (typeof parsed !== "object" || parsed === null) {
    throw new Error(`Invalid runtime public access proxy ready file '${readyPath}'.`);
  }

  const baseUrl = Reflect.get(parsed, "baseUrl");
  if (typeof baseUrl !== "string" || baseUrl.length === 0) {
    throw new Error(`Invalid runtime public access proxy ready file '${readyPath}'.`);
  }

  return { baseUrl };
}

async function registerRuntimePublicAccessRoutes(input: {
  proxy: RuntimePublicAccessProxy;
  environmentId: string;
  ingressRules: readonly RuntimePublicAccessIngressRule[];
}): Promise<boolean> {
  const endpoint = input.proxy.endpoints.http;
  if (endpoint === undefined) {
    throw new Error("Runtime public access proxy did not expose an HTTP endpoint.");
  }

  const response = await fetch(new URL("/__mistle/register", endpoint.hostBaseUrl), {
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify({
      environmentId: input.environmentId,
      routes: input.ingressRules,
    }),
  });
  if (!response.ok) {
    const bodyPreview = await readResponseBodyPreview(response);
    throw new Error(
      `Runtime public access proxy route registration failed with status ${String(response.status)}. Body: ${bodyPreview}`,
    );
  }

  console.info(
    JSON.stringify({
      event: "runtime_public_access.routes_registered",
      environmentId: input.environmentId,
      routeCount: input.ingressRules.length,
      routes: input.ingressRules,
    }),
  );

  return true;
}

async function unregisterRuntimePublicAccessRoutes(input: {
  proxy: RuntimePublicAccessProxy;
  environmentId: string;
}): Promise<void> {
  const endpoint = input.proxy.endpoints.http;
  if (endpoint === undefined) {
    throw new Error("Runtime public access proxy did not expose an HTTP endpoint.");
  }

  await fetch(new URL("/__mistle/unregister", endpoint.hostBaseUrl), {
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify({
      environmentId: input.environmentId,
    }),
  }).catch(() => undefined);
}

async function waitForRuntimePublicAccessRoutesReady(input: {
  proxy: RuntimePublicAccessProxy;
  environmentId: string;
  ingressRules: readonly RuntimePublicAccessIngressRule[];
  timeoutMs: number;
}): Promise<void> {
  const startedAt = Date.now();
  for (const rule of input.ingressRules) {
    const remainingTimeoutMs = Math.max(0, input.timeoutMs - (Date.now() - startedAt));
    await waitForRuntimePublicAccessRouteReady({
      proxy: input.proxy,
      environmentId: input.environmentId,
      publicHostname: rule.publicHostname,
      timeoutMs: remainingTimeoutMs,
    });
    if (rule.upgradeProbePath !== undefined) {
      await waitForRuntimePublicAccessUpgradeRouteReady({
        proxy: input.proxy,
        environmentId: input.environmentId,
        publicHostname: rule.publicHostname,
        upgradeProbePath: rule.upgradeProbePath,
        timeoutMs: Math.max(0, input.timeoutMs - (Date.now() - startedAt)),
      });
    }
  }
}

type RuntimePublicAccessRouteProbeOutcome =
  | {
      kind: "fetch_error";
      errorName: string;
      errorMessage: string;
    }
  | {
      kind: "http";
      status: number;
      statusText: string;
      bodyPreview: string;
    };

async function waitForRuntimePublicAccessRouteReady(input: {
  proxy: RuntimePublicAccessProxy;
  environmentId: string;
  publicHostname: string;
  timeoutMs: number;
}): Promise<void> {
  const startedAt = Date.now();
  const routeHealthUrl = createRuntimePublicAccessRouteHealthUrl(input);
  let attemptCount = 0;
  let lastProbeOutcome: RuntimePublicAccessRouteProbeOutcome | undefined;
  while (Date.now() - startedAt < input.timeoutMs) {
    attemptCount += 1;
    try {
      const response = await fetch(routeHealthUrl);
      if (response.ok) {
        console.info(
          JSON.stringify({
            event: "runtime_public_access.route_ready",
            environmentId: input.environmentId,
            publicHostname: input.publicHostname,
            routeHealthUrl: routeHealthUrl.toString(),
            attemptCount,
            elapsedMs: Date.now() - startedAt,
          }),
        );
        return;
      }
      lastProbeOutcome = {
        kind: "http",
        status: response.status,
        statusText: response.statusText,
        bodyPreview: await readResponseBodyPreview(response),
      };
    } catch (error) {
      lastProbeOutcome = {
        kind: "fetch_error",
        errorName: error instanceof Error ? error.name : "Error",
        errorMessage: error instanceof Error ? error.message : String(error),
      };
      // Keep polling until the environment-scoped route reaches the local service.
    }

    await systemSleeper.sleep(CloudflaredTunnelPollIntervalMs);
  }

  const proxyDiagnostics = await readRuntimePublicAccessProxyDiagnostics(input.proxy);
  throw new Error(
    `Timed out waiting for runtime Cloudflare public access route at ${routeHealthUrl.toString()} after ${String(input.timeoutMs)}ms. Diagnostics: ${JSON.stringify(
      {
        environmentId: input.environmentId,
        publicHostname: input.publicHostname,
        routeHealthUrl: routeHealthUrl.toString(),
        attemptCount,
        lastProbeOutcome,
        proxyDiagnostics,
      },
    )}`,
  );
}

type RuntimePublicAccessUpgradeProbeOutcome =
  | {
      kind: "connect_error";
      errorName: string;
      errorMessage: string;
    }
  | {
      kind: "http";
      status: number;
      statusText: string;
      rawStatusLine: string;
    };

async function waitForRuntimePublicAccessUpgradeRouteReady(input: {
  proxy: RuntimePublicAccessProxy;
  environmentId: string;
  publicHostname: string;
  upgradeProbePath: string;
  timeoutMs: number;
}): Promise<void> {
  const startedAt = Date.now();
  const upgradeProbeUrl = createRuntimePublicAccessRouteUpgradeProbeUrl(input);
  let attemptCount = 0;
  let lastProbeOutcome: RuntimePublicAccessUpgradeProbeOutcome | undefined;
  while (Date.now() - startedAt < input.timeoutMs) {
    attemptCount += 1;
    try {
      const response = await probeRuntimePublicAccessUpgradeRoute({
        url: upgradeProbeUrl,
        timeoutMs: RuntimePublicAccessUpgradeProbeTimeoutMs,
      });
      lastProbeOutcome = {
        kind: "http",
        status: response.status,
        statusText: response.statusText,
        rawStatusLine: response.rawStatusLine,
      };
      if (isRuntimePublicAccessUpgradeProbeReadyStatus(response.status)) {
        console.info(
          JSON.stringify({
            event: "runtime_public_access.upgrade_route_ready",
            environmentId: input.environmentId,
            publicHostname: input.publicHostname,
            upgradeProbeUrl: upgradeProbeUrl.toString(),
            status: response.status,
            rawStatusLine: response.rawStatusLine,
            attemptCount,
            elapsedMs: Date.now() - startedAt,
          }),
        );
        return;
      }
    } catch (error) {
      lastProbeOutcome = {
        kind: "connect_error",
        errorName: error instanceof Error ? error.name : "Error",
        errorMessage: error instanceof Error ? error.message : String(error),
      };
    }

    await systemSleeper.sleep(CloudflaredTunnelPollIntervalMs);
  }

  const proxyDiagnostics = await readRuntimePublicAccessProxyDiagnostics(input.proxy);
  throw new Error(
    `Timed out waiting for runtime Cloudflare public access upgrade route at ${upgradeProbeUrl.toString()} after ${String(input.timeoutMs)}ms. Diagnostics: ${JSON.stringify(
      {
        environmentId: input.environmentId,
        publicHostname: input.publicHostname,
        upgradeProbeUrl: upgradeProbeUrl.toString(),
        attemptCount,
        lastProbeOutcome,
        proxyDiagnostics,
      },
    )}`,
  );
}

function probeRuntimePublicAccessUpgradeRoute(input: {
  url: URL;
  timeoutMs: number;
}): Promise<{ status: number; statusText: string; rawStatusLine: string }> {
  return new Promise((resolve, reject) => {
    let settled = false;
    let responseBytes = "";
    const socket = connectTls({
      host: input.url.hostname,
      port: input.url.port.length === 0 ? 443 : Number(input.url.port),
      servername: input.url.hostname,
      timeout: input.timeoutMs,
    });

    const settle = (callback: () => void) => {
      if (settled) {
        return;
      }
      settled = true;
      socket.destroy();
      callback();
    };

    socket.on("secureConnect", () => {
      socket.write(createWebSocketUpgradeProbeRequest(input.url));
    });
    socket.on("data", (chunk) => {
      responseBytes += chunk.toString("utf8");
      const lineEndIndex = responseBytes.indexOf("\r\n");
      if (lineEndIndex < 0) {
        return;
      }

      const rawStatusLine = responseBytes.slice(0, lineEndIndex);
      const parsed = parseHttpStatusLine(rawStatusLine);
      if (parsed === undefined) {
        settle(() =>
          reject(
            new Error(`Invalid runtime public access upgrade probe response: ${rawStatusLine}`),
          ),
        );
        return;
      }

      settle(() =>
        resolve({
          ...parsed,
          rawStatusLine,
        }),
      );
    });
    socket.on("timeout", () => {
      settle(() =>
        reject(
          new Error(
            `Timed out waiting for runtime public access upgrade probe response from ${input.url.toString()}.`,
          ),
        ),
      );
    });
    socket.on("error", (error) => {
      settle(() => reject(error));
    });
  });
}

function createWebSocketUpgradeProbeRequest(url: URL): string {
  return [
    `GET ${url.pathname}${url.search} HTTP/1.1`,
    `Host: ${url.host}`,
    "Connection: Upgrade",
    "Upgrade: websocket",
    "Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==",
    "Sec-WebSocket-Version: 13",
    "",
    "",
  ].join("\r\n");
}

function parseHttpStatusLine(
  statusLine: string,
): { status: number; statusText: string } | undefined {
  const match = /^HTTP\/\d(?:\.\d)? (?<status>\d{3})(?: (?<statusText>.*))?$/.exec(statusLine);
  const status = match?.groups?.status;
  if (status === undefined) {
    return undefined;
  }

  return {
    status: Number(status),
    statusText: match?.groups?.statusText ?? "",
  };
}

export function isRuntimePublicAccessUpgradeProbeReadyStatus(status: number): boolean {
  return status === 101 || status === 400 || status === 401 || status === 403;
}

async function readResponseBodyPreview(response: Response): Promise<string> {
  const body = await response.text().catch((error: unknown) => {
    return `<<failed to read response body: ${
      error instanceof Error ? error.message : String(error)
    }>>`;
  });
  return body.slice(0, 1000);
}

async function readRuntimePublicAccessProxyDiagnostics(
  proxy: RuntimePublicAccessProxy,
): Promise<unknown> {
  const endpoint = proxy.endpoints.http;
  if (endpoint === undefined) {
    return {
      error: "runtime public access proxy did not expose an HTTP endpoint",
    };
  }

  try {
    const response = await fetch(new URL("/__mistle/diagnostics", endpoint.hostBaseUrl));
    const body = await response.text();
    let parsed: unknown;
    try {
      parsed = JSON.parse(body);
    } catch {
      parsed = {
        rawBody: body.slice(0, 1000),
      };
    }
    return {
      proxyPid: proxy.pid,
      proxyProcessAlive: proxy.pid === undefined ? undefined : isProcessAlive(proxy.pid),
      status: response.status,
      statusText: response.statusText,
      body: parsed,
    };
  } catch (error) {
    return {
      proxyPid: proxy.pid,
      proxyProcessAlive: proxy.pid === undefined ? undefined : isProcessAlive(proxy.pid),
      errorName: error instanceof Error ? error.name : "Error",
      error: error instanceof Error ? error.message : String(error),
      cause: readUnknownErrorCause(error),
    };
  }
}

function isProcessAlive(processId: number): boolean {
  try {
    process.kill(processId, 0);
    return true;
  } catch (error) {
    return typeof error === "object" && error !== null && Reflect.get(error, "code") === "EPERM";
  }
}

function readUnknownErrorCause(error: unknown): unknown {
  if (!(error instanceof Error) || error.cause === undefined) {
    return undefined;
  }
  const { cause } = error;
  if (cause instanceof Error) {
    return {
      name: cause.name,
      message: cause.message,
    };
  }
  return cause;
}

export function createRuntimePublicAccessRouteHealthUrl(input: {
  environmentId: string;
  publicHostname: string;
}): URL {
  const url = new URL("/__healthz", `https://${input.publicHostname}`);
  url.searchParams.set("x-mistle-test-environment-id", input.environmentId);
  return url;
}

export function createRuntimePublicAccessRouteUpgradeProbeUrl(input: {
  environmentId: string;
  publicHostname: string;
  upgradeProbePath: string;
}): URL {
  const url = new URL(input.upgradeProbePath, `wss://${input.publicHostname}`);
  url.searchParams.set("x-mistle-test-environment-id", input.environmentId);
  return url;
}

export function readRuntimePublicAccessEnvironmentIdFromPath(
  requestPath: string,
): string | undefined {
  const prefix = "/__test-environments/";
  if (!requestPath.startsWith(prefix)) {
    return undefined;
  }

  const pathWithoutPrefix = requestPath.slice(prefix.length);
  const separatorIndex = pathWithoutPrefix.indexOf("/");
  if (separatorIndex <= 0) {
    return undefined;
  }

  return decodeURIComponent(pathWithoutPrefix.slice(0, separatorIndex));
}

export function createRuntimePublicAccessProxyScript(): string {
  return String.raw`
import { spawn, spawnSync } from "node:child_process";
import { createWriteStream } from "node:fs";
import http from "node:http";
import net from "node:net";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";

const DockerHostGatewayName = "host.docker.internal";
const DiagnosticsLogTailBytes = 64 * 1024;
const DiagnosticsLocalOriginProbeTimeoutMs = 2_000;
const UpgradeTargetConnectRetryIntervalMs = 100;
const UpgradeTargetConnectTimeoutMs = 10_000;
const tunnelId = readRequiredEnv("MISTLE_RUNTIME_PUBLIC_ACCESS_TUNNEL_ID");
const tunnelCredentialsJson = readRequiredEnv("MISTLE_RUNTIME_PUBLIC_ACCESS_TUNNEL_CREDENTIALS_JSON");
const ownerPid = Number(readRequiredEnv("MISTLE_RUNTIME_PUBLIC_ACCESS_OWNER_PID"));
if (!Number.isSafeInteger(ownerPid) || ownerPid <= 0) {
  throw new Error("Runtime public access proxy requires a positive owner pid.");
}
const readyPath = readRequiredEnv("MISTLE_RUNTIME_PUBLIC_ACCESS_READY_PATH");
const logPath = readRequiredEnv("MISTLE_RUNTIME_PUBLIC_ACCESS_LOG_PATH");
const cloudflaredImage = readRequiredEnv("MISTLE_RUNTIME_PUBLIC_ACCESS_CLOUDFLARED_IMAGE");
const tunnelLabel = readRequiredEnv("MISTLE_RUNTIME_PUBLIC_ACCESS_TUNNEL_LABEL");
const publicHostnames = JSON.parse(readRequiredEnv("MISTLE_RUNTIME_PUBLIC_ACCESS_PUBLIC_HOSTNAMES"));
if (!Array.isArray(publicHostnames) || publicHostnames.some((value) => typeof value !== "string" || value.length === 0)) {
  throw new Error("Runtime public access proxy requires public hostnames.");
}
const proxyPort = Number(readRequiredEnv("MISTLE_RUNTIME_PUBLIC_ACCESS_PROXY_PORT"));
if (!Number.isSafeInteger(proxyPort) || proxyPort <= 0) {
  throw new Error("Runtime public access proxy requires a positive proxy port.");
}

const logStream = createWriteStream(logPath, { flags: "a" });
const routes = new Map();
const recentUpgradeFailures = [];
const server = http.createServer(handleRequest);
server.on("upgrade", handleUpgrade);
server.once("error", (error) => {
  startupFailed(error);
});
server.listen(proxyPort, "0.0.0.0", async () => {
  const address = server.address();
  if (address === null || typeof address === "string") {
    startupFailed(new Error("Runtime public access proxy did not listen on a TCP port."));
    return;
  }

  const proxyBaseUrl = "http://127.0.0.1:" + String(address.port);
  try {
    await startCloudflared(proxyBaseUrl);
    await writeFile(readyPath, JSON.stringify({ baseUrl: proxyBaseUrl }), "utf8");
  } catch (error) {
    startupFailed(error);
  }
});

let cloudflared;
let cloudflaredContainerName;
const ownerWatchdog = setInterval(() => {
  if (!isProcessAlive(ownerPid)) {
    logStream.write("owner process " + String(ownerPid) + " is no longer alive; shutting down\n");
    shutdown();
  }
}, 1000);
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);

function startupFailed(error) {
  const message = error instanceof Error ? error.stack ?? error.message : String(error);
  logStream.write("runtime public access proxy startup failed: " + message + "\n", () => {
    process.exit(1);
  });
}

async function handleRequest(request, response) {
  if (request.url === "/__healthz") {
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify({ ok: true }));
    return;
  }

  if (request.url === "/__mistle/diagnostics" && request.method === "GET") {
    const diagnostics = await buildDiagnostics();
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify(diagnostics));
    return;
  }

  if (request.url === "/__mistle/register" && request.method === "POST") {
    const body = await readBody(request);
    const parsed = JSON.parse(body);
    if (typeof parsed !== "object" || parsed === null || typeof parsed.environmentId !== "string" || !Array.isArray(parsed.routes)) {
      response.writeHead(400);
      response.end("Invalid registration payload.");
      return;
    }

    for (const route of parsed.routes) {
      if (typeof route !== "object" || route === null || typeof route.publicHostname !== "string" || typeof route.localBaseUrl !== "string") {
        response.writeHead(400);
        response.end("Invalid route payload.");
        return;
      }
      routes.set(createRouteKey(route.publicHostname, parsed.environmentId), route.localBaseUrl);
    }
    logStream.write("registered runtime public access routes environmentId=" + parsed.environmentId + " routeCount=" + String(parsed.routes.length) + "\n");
    response.writeHead(204);
    response.end();
    return;
  }

  if (request.url === "/__mistle/unregister" && request.method === "POST") {
    const body = await readBody(request);
    const parsed = JSON.parse(body);
    if (typeof parsed === "object" && parsed !== null && typeof parsed.environmentId === "string") {
      for (const key of routes.keys()) {
        if (key.endsWith(":" + parsed.environmentId)) {
          routes.delete(key);
        }
      }
      logStream.write("unregistered runtime public access routes environmentId=" + parsed.environmentId + "\n");
    }
    response.writeHead(204);
    response.end();
    return;
  }

  const target = resolveTarget(request);
  if (target === undefined) {
    response.writeHead(404);
    response.end("No runtime public access route registered.");
    return;
  }

  const targetUrl = new URL(request.url ?? "/", target.localBaseUrl);
  const proxyRequest = http.request(targetUrl, {
    method: request.method,
    headers: {
      ...request.headers,
      host: targetUrl.host,
      "x-mistle-test-environment-id": target.environmentId,
    },
  }, (proxyResponse) => {
    response.writeHead(proxyResponse.statusCode ?? 502, proxyResponse.headers);
    proxyResponse.pipe(response);
  });
  proxyRequest.on("error", (error) => {
    response.writeHead(502);
    response.end(error.message);
  });
  request.pipe(proxyRequest);
}

function handleUpgrade(request, socket, head) {
  const target = resolveTarget(request);
  if (target === undefined) {
    const routeContext = readRouteContext(request);
    recordUpgradeFailure({
      reason: "route_missing",
      host: routeContext.host,
      environmentId: routeContext.environmentId,
      requestUrl: request.url ?? "",
    });
    endSocketResponse(socket, 404, "Not Found", "No runtime public access route registered.");
    return;
  }

  const targetUrl = new URL(request.url ?? "/", target.localBaseUrl);
  connectUpgradeTarget({
    host: targetUrl.hostname,
    port: Number(targetUrl.port),
    timeoutMs: UpgradeTargetConnectTimeoutMs,
  }).then((targetSocket) => {
    const headers = Object.entries({
      ...request.headers,
      "x-mistle-test-environment-id": target.environmentId,
    })
      .map(([name, value]) => name + ": " + (Array.isArray(value) ? value.join(", ") : value ?? ""))
      .join("\r\n");
    targetSocket.write((request.method ?? "GET") + " " + targetUrl.pathname + targetUrl.search + " HTTP/" + request.httpVersion + "\r\n" + headers + "\r\n\r\n");
    if (head.length > 0) {
      targetSocket.write(head);
    }
    socket.pipe(targetSocket);
    targetSocket.pipe(socket);
  }).catch((error) => {
    recordUpgradeFailure({
      reason: "target_connect_failed",
      host: String(request.headers.host ?? "").split(":")[0],
      environmentId: target.environmentId,
      requestUrl: request.url ?? "",
      targetHost: targetUrl.hostname,
      targetPort: targetUrl.port,
      errorName: error instanceof Error ? error.name : "Error",
      errorMessage: error instanceof Error ? error.message : String(error),
    });
    endSocketResponse(socket, 502, "Bad Gateway", "Runtime public access upgrade target failed to connect.");
  });
}

function endSocketResponse(socket, status, statusText, body) {
  socket.end(
    "HTTP/1.1 " + String(status) + " " + statusText + "\r\n" +
      "content-type: text/plain; charset=utf-8\r\n" +
      "content-length: " + String(Buffer.byteLength(body, "utf8")) + "\r\n" +
      "connection: close\r\n" +
      "\r\n" +
      body,
  );
}

function recordUpgradeFailure(event) {
  const failure = {
    event: "runtime_public_access.upgrade_failed",
    timestamp: new Date().toISOString(),
    ...event,
  };
  recentUpgradeFailures.push(failure);
  while (recentUpgradeFailures.length > 50) {
    recentUpgradeFailures.shift();
  }
  logStream.write(JSON.stringify(failure) + "\n");
}

async function buildDiagnostics() {
  const routeDiagnostics = await Promise.all(
    Array.from(routes.entries()).map(async ([key, localBaseUrl]) => {
      const separatorIndex = key.lastIndexOf(":");
      const publicHostname = separatorIndex > 0 ? key.slice(0, separatorIndex) : key;
      const environmentId = separatorIndex > 0 ? key.slice(separatorIndex + 1) : "";
      return {
        key,
        publicHostname,
        environmentId,
        localBaseUrl,
        localOriginHealth: await probeLocalOriginHealth({ localBaseUrl, environmentId }),
      };
    }),
  );
  return {
    ok: true,
    publicHostnames,
    proxyPid: process.pid,
    ownerPid,
    ownerProcessAlive: isProcessAlive(ownerPid),
    cloudflaredContainerName,
    cloudflaredPid: cloudflared?.pid,
    cloudflaredProcessExitCode: cloudflared?.exitCode,
    cloudflaredProcessSignalCode: cloudflared?.signalCode,
    cloudflaredContainer: readCloudflaredContainerDiagnostics(),
    proxyLogTail: await readFileTail(logPath, DiagnosticsLogTailBytes),
    cloudflaredDockerLogTail: readCloudflaredDockerLogTail(),
    routeCount: routes.size,
    recentUpgradeFailures,
    routes: routeDiagnostics,
  };
}

async function probeLocalOriginHealth(input) {
  try {
    const healthUrl = new URL("/__healthz", input.localBaseUrl);
    const response = await fetch(healthUrl, {
      headers: {
        "x-mistle-test-environment-id": input.environmentId,
      },
      signal: AbortSignal.timeout(DiagnosticsLocalOriginProbeTimeoutMs),
    });
    return {
      kind: "http",
      url: healthUrl.toString(),
      status: response.status,
      statusText: response.statusText,
      bodyPreview: (await response.text()).slice(0, 1000),
    };
  } catch (error) {
    return {
      kind: "fetch_error",
      errorName: error instanceof Error ? error.name : "Error",
      errorMessage: error instanceof Error ? error.message : String(error),
      cause: readErrorCause(error),
    };
  }
}

function readCloudflaredContainerDiagnostics() {
  if (cloudflaredContainerName === undefined) {
    return null;
  }
  const inspect = spawnSync("docker", [
    "inspect",
    "--format",
    "{{json .State}}",
    cloudflaredContainerName,
  ], {
    encoding: "utf8",
  });
  return {
    exitCode: inspect.status,
    stdout: inspect.stdout.slice(0, 4000),
    stderr: inspect.stderr.slice(0, 4000),
  };
}

function readCloudflaredDockerLogTail() {
  if (cloudflaredContainerName === undefined) {
    return null;
  }
  const logs = spawnSync("docker", ["logs", "--tail", "200", cloudflaredContainerName], {
    encoding: "utf8",
  });
  return {
    exitCode: logs.status,
    stdout: logs.stdout.slice(-DiagnosticsLogTailBytes),
    stderr: logs.stderr.slice(-DiagnosticsLogTailBytes),
  };
}

async function readFileTail(path, maxBytes) {
  try {
    const content = await readFile(path, "utf8");
    return content.slice(-maxBytes);
  } catch (error) {
    return "<failed to read log file: " + (error instanceof Error ? error.message : String(error)) + ">";
  }
}

function readErrorCause(error) {
  if (!(error instanceof Error) || error.cause === undefined) {
    return undefined;
  }
  const cause = error.cause;
  if (cause instanceof Error) {
    return {
      name: cause.name,
      message: cause.message,
    };
  }
  return String(cause);
}

function connectUpgradeTarget(input) {
  const deadline = Date.now() + input.timeoutMs;
  return new Promise((resolve, reject) => {
    const tryConnect = () => {
      const targetSocket = net.connect({
        host: input.host,
        port: input.port,
      });
      targetSocket.once("connect", () => {
        resolve(targetSocket);
      });
      targetSocket.once("error", (error) => {
        targetSocket.destroy();
        if (Date.now() >= deadline) {
          reject(error);
          return;
        }
        setTimeout(tryConnect, UpgradeTargetConnectRetryIntervalMs);
      });
    };

    tryConnect();
  });
}

function resolveTarget(request) {
  const routeContext = readRouteContext(request);
  if (routeContext.host.length === 0 || routeContext.environmentId.length === 0) {
    return undefined;
  }
  const localBaseUrl = routes.get(createRouteKey(routeContext.host, routeContext.environmentId));
  if (localBaseUrl === undefined) {
    return undefined;
  }
  return {
    environmentId: routeContext.environmentId,
    localBaseUrl,
  };
}

function readRouteContext(request) {
  const host = String(request.headers.host ?? "").split(":")[0];
  const requestUrl = new URL(request.url ?? "/", "http://" + host);
  const environmentId = String(request.headers["x-mistle-test-environment-id"] ?? requestUrl.searchParams.get("x-mistle-test-environment-id") ?? readEnvironmentIdFromPath(requestUrl.pathname) ?? "");
  return {
    host,
    environmentId,
    requestUrl,
  };
}

function readEnvironmentIdFromPath(requestPath) {
  const prefix = "/__test-environments/";
  if (!requestPath.startsWith(prefix)) {
    return undefined;
  }
  const pathWithoutPrefix = requestPath.slice(prefix.length);
  const separatorIndex = pathWithoutPrefix.indexOf("/");
  if (separatorIndex <= 0) {
    return undefined;
  }
  return decodeURIComponent(pathWithoutPrefix.slice(0, separatorIndex));
}

function createRouteKey(hostname, environmentId) {
  return hostname + ":" + environmentId;
}

function readBody(request) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    request.on("data", (chunk) => chunks.push(chunk));
    request.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    request.on("error", reject);
  });
}

async function startCloudflared(proxyBaseUrl) {
  const configDirectory = await mkdtemp(join(tmpdir(), "mistle-runtime-cloudflared-proxy-"));
  const configPath = join(configDirectory, "config.yml");
  const credentialsPath = join(configDirectory, "credentials.json");
  const containerName = "mistle-runtime-cloudflared-" + randomUUID().replaceAll("-", "");
  cloudflaredContainerName = containerName;
  const config = [
    "tunnel: " + tunnelId,
    "credentials-file: /etc/cloudflared/credentials.json",
    "ingress:",
    ...publicHostnames.flatMap((hostname) => [
      "  - hostname: " + hostname,
      "    service: " + proxyBaseUrl.replace("127.0.0.1", DockerHostGatewayName),
    ]),
    "  - service: http_status:404",
    "",
  ].join("\n");
  await writeFile(credentialsPath, tunnelCredentialsJson, "utf8");
  await writeFile(configPath, config, "utf8");
  cloudflared = spawn("docker", [
    "run",
    "--rm",
    "--name",
    containerName,
    "--label",
    tunnelLabel + "=" + tunnelId,
    "--add-host",
    DockerHostGatewayName + ":host-gateway",
    "--volume",
    configPath + ":/etc/cloudflared/config.yml:ro",
    "--volume",
    credentialsPath + ":/etc/cloudflared/credentials.json:ro",
    cloudflaredImage,
    "tunnel",
    "--config",
    "/etc/cloudflared/config.yml",
    "run",
    tunnelId,
  ], { stdio: ["ignore", "pipe", "pipe"] });
  cloudflared.stdout.pipe(logStream, { end: false });
  cloudflared.stderr.pipe(logStream, { end: false });
  cloudflared.on("exit", (code, signal) => {
    logStream.write("cloudflared container process exited code=" + String(code) + " signal=" + String(signal) + "\n");
  });
}

function shutdown() {
  clearInterval(ownerWatchdog);
  server.close();
  if (cloudflared !== undefined) {
    cloudflared.kill("SIGTERM");
  }
  if (cloudflaredContainerName !== undefined) {
    spawnSync("docker", ["rm", "--force", cloudflaredContainerName], { stdio: "ignore" });
  }
  logStream.end();
  process.exit(0);
}

function isProcessAlive(processId) {
  try {
    process.kill(processId, 0);
    return true;
  } catch (error) {
    if (typeof error === "object" && error !== null && error.code === "EPERM") {
      return true;
    }

    return false;
  }
}

function readRequiredEnv(name) {
  const value = process.env[name];
  if (value === undefined || value.length === 0) {
    throw new Error("Missing required environment variable " + name + ".");
  }
  return value;
}
`;
}

async function waitForCloudflaredHealth(input: {
  publicBaseUrl: string;
  timeoutMs: number;
}): Promise<void> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < input.timeoutMs) {
    try {
      const response = await fetch(new URL("/__healthz", input.publicBaseUrl));
      if (response.ok) {
        return;
      }
    } catch {
      // Keep polling until the tunnel route is active or the explicit timeout expires.
    }

    await systemSleeper.sleep(CloudflaredTunnelPollIntervalMs);
  }

  throw new Error(
    `Timed out waiting for runtime Cloudflare public access at ${input.publicBaseUrl}/__healthz after ${String(input.timeoutMs)}ms.`,
  );
}
