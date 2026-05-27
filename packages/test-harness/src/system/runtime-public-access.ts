import { spawn } from "node:child_process";
import { appendFile, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
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
const RuntimePublicAccessProxyDiagnosticsLogTailBytes = 64 * 1024;

export type RuntimePublicAccessTunnel = {
  publicBaseUrls: ReadonlyMap<string, string>;
  checkReady: (input?: RuntimePublicAccessReadinessCheckInput) => Promise<void>;
  registerWebhookMarkerRoute: (input: RuntimePublicAccessWebhookMarkerRouteInput) => Promise<void>;
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

export type RuntimePublicAccessWebhookMarkerRouteInput = {
  marker: string;
  publicHostname: string;
  targetPath: string;
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
    registerWebhookMarkerRoute: async (routeInput) => {
      await registerRuntimePublicAccessWebhookMarkerRoute({
        proxy,
        environmentId: input.environmentId,
        markerRoute: routeInput,
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

export function createRuntimePublicAccessRouteStatePath(input: {
  coordinatorDir: string;
  tunnelId: string;
}): string {
  return join(
    input.coordinatorDir,
    "runtime-public-access-routes",
    `${encodeURIComponent(input.tunnelId)}.json`,
  );
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
  metadata: Readonly<Record<string, string>>;
  stop: () => Promise<void>;
}> {
  const workDirectoryPath = await mkdtemp(
    join(input.coordinatorDir, "runtime-public-access-proxy-"),
  );
  await mkdir(workDirectoryPath, { recursive: true });
  const scriptPath = join(workDirectoryPath, "proxy.mjs");
  const readyPath = join(workDirectoryPath, "ready.json");
  const logPath = join(workDirectoryPath, "proxy.log");
  const routeStatePath = createRuntimePublicAccessRouteStatePath({
    coordinatorDir: input.coordinatorDir,
    tunnelId: input.tunnelId,
  });
  await mkdir(join(input.coordinatorDir, "runtime-public-access-routes"), { recursive: true });
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
      MISTLE_RUNTIME_PUBLIC_ACCESS_ROUTE_STATE_PATH: routeStatePath,
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
  child.once("exit", (code, signal) => {
    void appendFile(
      logPath,
      `runtime public access proxy process exited code=${String(code)} signal=${String(signal)}\n`,
      "utf8",
    ).catch(() => undefined);
  });

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
      metadata: {
        logPath,
        proxyPort: String(proxyPort),
        routeStatePath,
        workDirectoryPath,
      },
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

async function registerRuntimePublicAccessWebhookMarkerRoute(input: {
  proxy: RuntimePublicAccessProxy;
  environmentId: string;
  markerRoute: RuntimePublicAccessWebhookMarkerRouteInput;
}): Promise<void> {
  const endpoint = input.proxy.endpoints.http;
  if (endpoint === undefined) {
    throw new Error("Runtime public access proxy did not expose an HTTP endpoint.");
  }

  const response = await fetch(new URL("/__mistle/register-webhook-marker", endpoint.hostBaseUrl), {
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify({
      environmentId: input.environmentId,
      marker: input.markerRoute.marker,
      publicHostname: input.markerRoute.publicHostname,
      targetPath: input.markerRoute.targetPath,
    }),
  });
  if (!response.ok) {
    const bodyPreview = await readResponseBodyPreview(response);
    throw new Error(
      `Runtime public access proxy webhook marker route registration failed with status ${String(response.status)}. Body: ${bodyPreview}`,
    );
  }

  console.info(
    JSON.stringify({
      event: "runtime_public_access.webhook_marker_route_registered",
      environmentId: input.environmentId,
      marker: input.markerRoute.marker,
      publicHostname: input.markerRoute.publicHostname,
      targetPath: input.markerRoute.targetPath,
    }),
  );
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
  const processDiagnostics = await readRuntimePublicAccessProxyProcessDiagnostics(proxy);
  if (endpoint === undefined) {
    return {
      error: "runtime public access proxy did not expose an HTTP endpoint",
      ...processDiagnostics,
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
      ...processDiagnostics,
      status: response.status,
      statusText: response.statusText,
      body: parsed,
    };
  } catch (error) {
    return {
      ...processDiagnostics,
      errorName: error instanceof Error ? error.name : "Error",
      error: error instanceof Error ? error.message : String(error),
      cause: readUnknownErrorCause(error),
    };
  }
}

async function readRuntimePublicAccessProxyProcessDiagnostics(
  proxy: RuntimePublicAccessProxy,
): Promise<{
  proxyPid: number | undefined;
  proxyProcessAlive: boolean | undefined;
  proxyMetadata: Readonly<Record<string, string>> | undefined;
  proxyLogTail: string | undefined;
}> {
  return {
    proxyPid: proxy.pid,
    proxyProcessAlive: proxy.pid === undefined ? undefined : isProcessAlive(proxy.pid),
    proxyMetadata: proxy.metadata,
    proxyLogTail:
      proxy.metadata?.logPath === undefined
        ? undefined
        : await readTextFileTail(
            proxy.metadata.logPath,
            RuntimePublicAccessProxyDiagnosticsLogTailBytes,
          ),
  };
}

async function readTextFileTail(filePath: string, maxBytes: number): Promise<string> {
  try {
    const content = await readFile(filePath, "utf8");
    return content.slice(-maxBytes);
  } catch (error) {
    return `<failed to read ${filePath}: ${error instanceof Error ? error.message : String(error)}>`;
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

export function createRuntimePublicAccessServiceBaseUrl(input: {
  environmentId: string;
  publicHostname: string;
}): string {
  const encodedEnvironmentId = encodeURIComponent(input.environmentId);
  return `https://${input.publicHostname}/__test-environments/${encodedEnvironmentId}`;
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
import { mkdir, mkdtemp, readFile, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";

const DockerHostGatewayName = "host.docker.internal";
const DiagnosticsLogTailBytes = 64 * 1024;
const DiagnosticsLocalOriginProbeTimeoutMs = 2_000;
const UpgradeTargetConnectRetryIntervalMs = 100;
const UpgradeTargetConnectTimeoutMs = 10_000;
const WebhookMarkerRouterPath = "/__mistle/webhook-router/github";
const tunnelId = readRequiredEnv("MISTLE_RUNTIME_PUBLIC_ACCESS_TUNNEL_ID");
const tunnelCredentialsJson = readRequiredEnv("MISTLE_RUNTIME_PUBLIC_ACCESS_TUNNEL_CREDENTIALS_JSON");
const ownerPid = Number(readRequiredEnv("MISTLE_RUNTIME_PUBLIC_ACCESS_OWNER_PID"));
if (!Number.isSafeInteger(ownerPid) || ownerPid <= 0) {
  throw new Error("Runtime public access proxy requires a positive owner pid.");
}
const readyPath = readRequiredEnv("MISTLE_RUNTIME_PUBLIC_ACCESS_READY_PATH");
const logPath = readRequiredEnv("MISTLE_RUNTIME_PUBLIC_ACCESS_LOG_PATH");
const routeStatePath = readRequiredEnv("MISTLE_RUNTIME_PUBLIC_ACCESS_ROUTE_STATE_PATH");
const routeStateLockPath = routeStatePath + ".lock";
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
const webhookMarkerRoutes = new Map();
const recentUpgradeFailures = [];
const server = http.createServer(dispatchRequest);
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
    await loadRoutes();
    await startCloudflared(proxyBaseUrl);
    await writeFile(readyPath, JSON.stringify({ baseUrl: proxyBaseUrl }), "utf8");
  } catch (error) {
    startupFailed(error);
  }
});

let cloudflared;
let cloudflaredContainerName;
let shuttingDown = false;
const ownerWatchdog = setInterval(() => {
  if (!isProcessAlive(ownerPid)) {
    shutdown("owner process " + String(ownerPid) + " is no longer alive");
  }
}, 1000);
process.on("SIGTERM", () => {
  shutdown("SIGTERM");
});
process.on("SIGINT", () => {
  shutdown("SIGINT");
});
process.on("uncaughtException", (error) => {
  fatalProcessError("uncaughtException", error);
});
process.on("unhandledRejection", (reason) => {
  fatalProcessError("unhandledRejection", reason);
});

function startupFailed(error) {
  const message = formatUnknownError(error);
  logStream.write("runtime public access proxy startup failed: " + message + "\n", () => {
    process.exit(1);
  });
}

function fatalProcessError(kind, error) {
  if (shuttingDown) {
    return;
  }

  const message = formatUnknownError(error);
  logStream.write("runtime public access proxy " + kind + ": " + message + "\n", () => {
    process.exit(1);
  });
}

function formatUnknownError(error) {
  return error instanceof Error ? error.stack ?? error.message : String(error);
}

function dispatchRequest(request, response) {
  void handleRequest(request, response).catch((error) => {
    logStream.write("runtime public access proxy request failed: " + formatUnknownError(error) + "\n");
    if (!response.headersSent) {
      response.writeHead(500);
    }
    response.end("Runtime public access proxy request failed.");
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

    if (parsed.routes.some((route) => typeof route !== "object" || route === null || typeof route.publicHostname !== "string" || typeof route.localBaseUrl !== "string")) {
      response.writeHead(400);
      response.end("Invalid route payload.");
      return;
    }
    await mutateRoutes(async () => {
      await loadRoutes();
      for (const route of parsed.routes) {
        routes.set(createRouteKey(route.publicHostname, parsed.environmentId), route.localBaseUrl);
      }
      await persistRoutes();
      logStream.write("registered runtime public access routes environmentId=" + parsed.environmentId + " routeCount=" + String(parsed.routes.length) + " totalRouteCount=" + String(routes.size) + "\n");
    });
    response.writeHead(204);
    response.end();
    return;
  }

  if (request.url === "/__mistle/unregister" && request.method === "POST") {
    const body = await readBody(request);
    const parsed = JSON.parse(body);
    if (typeof parsed === "object" && parsed !== null && typeof parsed.environmentId === "string") {
      await mutateRoutes(async () => {
        await loadRoutes();
        for (const key of routes.keys()) {
          if (key.endsWith(":" + parsed.environmentId)) {
            routes.delete(key);
          }
        }
        for (const [marker, markerRoute] of webhookMarkerRoutes.entries()) {
          if (markerRoute.environmentId === parsed.environmentId) {
            webhookMarkerRoutes.delete(marker);
          }
        }
        await persistRoutes();
        logStream.write("unregistered runtime public access routes environmentId=" + parsed.environmentId + " totalRouteCount=" + String(routes.size) + "\n");
      });
    }
    response.writeHead(204);
    response.end();
    return;
  }

  if (request.url === "/__mistle/register-webhook-marker" && request.method === "POST") {
    const body = await readBody(request);
    const parsed = JSON.parse(body);
    if (
      typeof parsed !== "object" ||
      parsed === null ||
      typeof parsed.environmentId !== "string" ||
      typeof parsed.marker !== "string" ||
      typeof parsed.publicHostname !== "string" ||
      typeof parsed.targetPath !== "string" ||
      parsed.marker.length === 0 ||
      parsed.publicHostname.length === 0 ||
      !parsed.targetPath.startsWith("/") ||
      parsed.targetPath.startsWith("//")
    ) {
      response.writeHead(400);
      response.end("Invalid webhook marker route payload.");
      return;
    }

    await mutateRoutes(async () => {
      await loadRoutes();
      const routeKey = createRouteKey(parsed.publicHostname, parsed.environmentId);
      if (!routes.has(routeKey)) {
        throw new Error("Cannot register webhook marker for missing route " + routeKey + ".");
      }
      webhookMarkerRoutes.set(parsed.marker, {
        environmentId: parsed.environmentId,
        publicHostname: parsed.publicHostname,
        targetPath: parsed.targetPath,
      });
      await persistRoutes();
      logStream.write("registered runtime public access webhook marker environmentId=" + parsed.environmentId + " publicHostname=" + parsed.publicHostname + " marker=" + parsed.marker + " totalWebhookMarkerRouteCount=" + String(webhookMarkerRoutes.size) + "\n");
    });
    response.writeHead(204);
    response.end();
    return;
  }

  const routeContext = readRouteContext(request);
  const bodyBuffer =
    isWebhookMarkerRouterRequest(routeContext)
      ? await readBodyBuffer(request)
      : undefined;
  const target = await resolveTarget(request, bodyBuffer);
  if (target === undefined) {
    response.writeHead(404);
    response.end("No runtime public access route registered.");
    return;
  }

  const targetPath = target.targetPath ?? stripEnvironmentPathPrefix(request.url ?? "/");
  const targetUrl = new URL(targetPath, target.localBaseUrl);
  const proxyHeaders = {
    ...request.headers,
    host: targetUrl.host,
    "x-mistle-test-environment-id": target.environmentId,
  };
  if (bodyBuffer !== undefined) {
    proxyHeaders["content-length"] = String(bodyBuffer.length);
    delete proxyHeaders["transfer-encoding"];
  }
  const proxyRequest = http.request(targetUrl, {
    method: request.method,
    headers: proxyHeaders,
  }, (proxyResponse) => {
    response.writeHead(proxyResponse.statusCode ?? 502, proxyResponse.headers);
    proxyResponse.pipe(response);
  });
  proxyRequest.on("error", (error) => {
    response.writeHead(502);
    response.end(error.message);
  });
  if (bodyBuffer === undefined) {
    request.pipe(proxyRequest);
  } else {
    proxyRequest.end(bodyBuffer);
  }
}

function handleUpgrade(request, socket, head) {
  void handleUpgradeRequest(request, socket, head).catch((error) => {
    const routeContext = readRouteContext(request);
    recordUpgradeFailure({
      reason: "proxy_error",
      host: routeContext.host,
      environmentId: routeContext.environmentId,
      requestUrl: request.url ?? "",
      errorName: error instanceof Error ? error.name : "Error",
      errorMessage: error instanceof Error ? error.message : String(error),
    });
    endSocketResponse(socket, 500, "Internal Server Error", "Runtime public access upgrade failed.");
  });
}

async function handleUpgradeRequest(request, socket, head) {
  const target = await resolveTarget(request, Buffer.alloc(0));
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

  const targetUrl = new URL(stripEnvironmentPathPrefix(request.url ?? "/"), target.localBaseUrl);
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
    pipeUpgradeSockets({
      request,
      socket,
      targetSocket,
      target,
      targetUrl,
    });
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

function pipeUpgradeSockets(input) {
  let closed = false;
  const closeSockets = () => {
    if (closed) {
      return;
    }

    closed = true;
    input.socket.destroy();
    input.targetSocket.destroy();
  };
  const recordSocketError = (reason, error) => {
    recordUpgradeFailure({
      reason,
      host: String(input.request.headers.host ?? "").split(":")[0],
      environmentId: input.target.environmentId,
      requestUrl: input.request.url ?? "",
      targetHost: input.targetUrl.hostname,
      targetPort: input.targetUrl.port,
      errorName: error instanceof Error ? error.name : "Error",
      errorMessage: error instanceof Error ? error.message : String(error),
    });
  };

  input.socket.on("error", (error) => {
    recordSocketError("client_socket_error", error);
    closeSockets();
  });
  input.targetSocket.on("error", (error) => {
    recordSocketError("target_socket_error", error);
    closeSockets();
  });
  input.socket.on("close", closeSockets);
  input.targetSocket.on("close", closeSockets);
  input.socket.pipe(input.targetSocket);
  input.targetSocket.pipe(input.socket);
}

function endSocketResponse(socket, status, statusText, body) {
  if (socket.destroyed) {
    return;
  }

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
  await loadRoutes();
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
    routeStatePath,
    routeCount: routes.size,
    webhookMarkerRouteCount: webhookMarkerRoutes.size,
    recentUpgradeFailures,
    routes: routeDiagnostics,
    webhookMarkerRoutes: Array.from(webhookMarkerRoutes.entries()).map(([marker, route]) => ({
      marker,
      environmentId: route.environmentId,
      publicHostname: route.publicHostname,
      targetPath: route.targetPath,
    })),
  };
}

async function mutateRoutes(callback) {
  await withRouteStateLock(callback);
}

async function withRouteStateLock(callback) {
  const deadline = Date.now() + 30_000;
  let lockAcquired = false;
  while (!lockAcquired) {
    try {
      await mkdir(routeStateLockPath);
      lockAcquired = true;
    } catch (error) {
      if (typeof error !== "object" || error === null || error.code !== "EEXIST") {
        throw error;
      }
      if (Date.now() >= deadline) {
        throw new Error("Timed out waiting for runtime public access route state lock.", {
          cause: error,
        });
      }
      await sleep(50);
    }
  }

  try {
    return await callback();
  } finally {
    await rm(routeStateLockPath, { recursive: true, force: true });
  }
}

async function loadRoutes() {
  let content;
  try {
    content = await readFile(routeStatePath, "utf8");
  } catch (error) {
    if (typeof error === "object" && error !== null && error.code === "ENOENT") {
      routes.clear();
      webhookMarkerRoutes.clear();
      return;
    }
    throw error;
  }

  const parsed = JSON.parse(content);
  if (typeof parsed !== "object" || parsed === null || !Array.isArray(parsed.routes)) {
    throw new Error("Invalid runtime public access route state file.");
  }

  routes.clear();
  webhookMarkerRoutes.clear();
  for (const route of parsed.routes) {
    if (typeof route !== "object" || route === null || typeof route.key !== "string" || typeof route.localBaseUrl !== "string") {
      throw new Error("Invalid runtime public access route state entry.");
    }
    routes.set(route.key, route.localBaseUrl);
  }
  if (parsed.webhookMarkerRoutes !== undefined) {
    if (!Array.isArray(parsed.webhookMarkerRoutes)) {
      throw new Error("Invalid runtime public access webhook marker route state file.");
    }
    for (const markerRoute of parsed.webhookMarkerRoutes) {
      if (
        typeof markerRoute !== "object" ||
        markerRoute === null ||
        typeof markerRoute.marker !== "string" ||
        typeof markerRoute.environmentId !== "string" ||
        typeof markerRoute.publicHostname !== "string" ||
        typeof markerRoute.targetPath !== "string"
      ) {
        throw new Error("Invalid runtime public access webhook marker route state entry.");
      }
      webhookMarkerRoutes.set(markerRoute.marker, {
        environmentId: markerRoute.environmentId,
        publicHostname: markerRoute.publicHostname,
        targetPath: markerRoute.targetPath,
      });
    }
  }
}

async function persistRoutes() {
  const tempPath = routeStatePath + "." + String(process.pid) + "." + randomUUID() + ".tmp";
  await writeFile(
    tempPath,
    JSON.stringify({
      version: 1,
      updatedAt: new Date().toISOString(),
      routes: Array.from(routes.entries()).map(([key, localBaseUrl]) => ({ key, localBaseUrl })),
      webhookMarkerRoutes: Array.from(webhookMarkerRoutes.entries()).map(([marker, route]) => ({
        marker,
        environmentId: route.environmentId,
        publicHostname: route.publicHostname,
        targetPath: route.targetPath,
      })),
    }),
    "utf8",
  );
  await rename(tempPath, routeStatePath);
}

function sleep(delayMs) {
  return new Promise((resolve) => {
    setTimeout(resolve, delayMs);
  });
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

async function resolveTarget(request, bodyBuffer) {
  const routeContext = readRouteContext(request);
  if (routeContext.host.length === 0) {
    return undefined;
  }
  await loadRoutes();
  if (routeContext.environmentId.length === 0) {
    if (bodyBuffer === undefined) {
      return undefined;
    }
    return resolveWebhookMarkerTarget({
      host: routeContext.host,
      bodyText: bodyBuffer.toString("utf8"),
    });
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

function resolveWebhookMarkerTarget(input) {
  for (const [marker, markerRoute] of webhookMarkerRoutes.entries()) {
    if (markerRoute.publicHostname !== input.host || !input.bodyText.includes(marker)) {
      continue;
    }

    const localBaseUrl = routes.get(createRouteKey(input.host, markerRoute.environmentId));
    if (localBaseUrl === undefined) {
      return undefined;
    }

    return {
      environmentId: markerRoute.environmentId,
      localBaseUrl,
      targetPath: markerRoute.targetPath,
    };
  }

  return undefined;
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

function isWebhookMarkerRouterRequest(routeContext) {
  return routeContext.host.length > 0 && routeContext.environmentId.length === 0 && routeContext.requestUrl.pathname === WebhookMarkerRouterPath;
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

function stripEnvironmentPathPrefix(requestUrl) {
  const parsedUrl = new URL(requestUrl, "http://runtime-public-access.local");
  const prefix = "/__test-environments/";
  if (!parsedUrl.pathname.startsWith(prefix)) {
    return requestUrl;
  }
  const pathWithoutPrefix = parsedUrl.pathname.slice(prefix.length);
  const separatorIndex = pathWithoutPrefix.indexOf("/");
  if (separatorIndex <= 0) {
    return requestUrl;
  }
  const targetPath = pathWithoutPrefix.slice(separatorIndex);
  return targetPath + parsedUrl.search;
}

function createRouteKey(hostname, environmentId) {
  return hostname + ":" + environmentId;
}

function readBody(request) {
  return readBodyBuffer(request).then((buffer) => buffer.toString("utf8"));
}

function readBodyBuffer(request) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    request.on("data", (chunk) => chunks.push(chunk));
    request.on("end", () => resolve(Buffer.concat(chunks)));
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
    logStream.write("cloudflared container process exited code=" + String(code) + " signal=" + String(signal) + " shuttingDown=" + String(shuttingDown) + "\n");
  });
}

function shutdown(reason) {
  if (shuttingDown) {
    return;
  }

  shuttingDown = true;
  clearInterval(ownerWatchdog);
  logStream.write("runtime public access proxy shutdown reason=" + String(reason) + "\n");
  server.close();
  if (cloudflared !== undefined) {
    cloudflared.kill("SIGTERM");
  }
  if (cloudflaredContainerName !== undefined) {
    spawnSync("docker", ["rm", "--force", cloudflaredContainerName], { stdio: "ignore" });
  }
  logStream.end(() => {
    process.exit(0);
  });
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
