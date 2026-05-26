/* eslint-disable jest/no-standalone-expect --
 * The integration harness returns a Vitest fixture-bound `it` function.
 */

import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { promisify } from "node:util";

import { PortAccessLinkCreatedByKinds } from "@mistle/db/control-plane";
import {
  SandboxInstancePersistenceModes,
  SandboxInstancePurposes,
  SandboxInstanceSources,
  SandboxInstanceStatuses,
} from "@mistle/db/data-plane";
import { mintBootstrapToken } from "@mistle/gateway-tunnel-auth";
import {
  createIntegrationTest,
  TestEnvironmentIdHeader,
  type IntegrationTestEnvironment,
} from "@mistle/test-harness/integration";
import { systemSleeper } from "@mistle/time";
import { expect } from "vitest";
import WebSocket from "ws";

import { resetDashboardConfigForTest } from "../src/config.js";
import { setControlPlaneRequestHeadersForTest } from "../src/features/api/request-control-plane.js";
import {
  createSandboxInstancePortAccess,
  redeemPortAccessLink,
} from "../src/features/sessions/sessions-service.js";
import { resetControlPlaneApiClientForTest } from "../src/lib/control-plane-api/client.js";

const execFileAsync = promisify(execFile);
const BootstrapTokenSecret = "integration-new-bootstrap-token-secret";
const BootstrapTokenIssuer = "integration-new-data-plane-worker";
const GatewayTokenAudience = "integration-new-data-plane-gateway";

const it = createIntegrationTest({
  services: ["control-plane-api", "data-plane-api", "data-plane-gateway"],
});

const IntegrationDashboardBaseUrl = "http://localhost:5173";

it("creates sandbox port access through the real control-plane API", async ({ env }) => {
  const session = await env.auth.createSession({
    organizationName: "Dashboard Port Access Integration",
  });
  const sandboxInstanceId = "sbi_dashboard_port_access_001";
  const providerSandboxId = await startDockerSandboxContainer();
  let bootstrapSocket: WebSocket | undefined;

  try {
    await env.dataPlaneDb.insert(env.dataPlaneTables.sandboxInstances).values({
      id: sandboxInstanceId,
      organizationId: session.organizationId,
      sandboxProfileId: "sbp_dashboard_port_access",
      title: "Dashboard port access sandbox",
      sandboxProfileVersion: 1,
      runtimeProvider: "docker",
      providerSandboxId,
      persistenceMode: SandboxInstancePersistenceModes.PERSISTENT,
      status: SandboxInstanceStatuses.RUNNING,
      startedByKind: "user",
      startedById: session.userId,
      source: SandboxInstanceSources.DASHBOARD,
      purpose: SandboxInstancePurposes.SESSION,
      failureCode: null,
      failureMessage: null,
    });
    bootstrapSocket = await attachBootstrapRuntime({
      env,
      sandboxInstanceId,
    });
    await waitForGatewayRuntimeReady(env, sandboxInstanceId);

    Object.assign(import.meta.env, {
      VITE_CONTROL_PLANE_API_ORIGIN: env.controlPlaneApi.hostBaseUrl,
      VITE_MISTLE_RELEASE_VERSION: "0.18.1",
    });
    resetDashboardConfigForTest();
    resetControlPlaneApiClientForTest();
    setControlPlaneRequestHeadersForTest({
      cookie: session.cookie,
      [TestEnvironmentIdHeader]: env.id,
    });

    const portAccess = await createSandboxInstancePortAccess({
      instanceId: sandboxInstanceId,
      port: 5173,
    });

    const portAccessUrl = new URL(portAccess.url);
    const slug = portAccessUrl.pathname.replace("/p/ports/", "");

    expect(portAccess.host).toMatch(/^p-5173--[a-z0-9]+\.mistle\.localhost$/);
    expect(portAccessUrl.origin).toBe(IntegrationDashboardBaseUrl);
    expect(slug).toMatch(/^[0-9A-Za-z]{12}$/u);
    expect(new Date(portAccess.expiresAt).getTime()).toBeGreaterThan(Date.now());

    const bootstrapUrl = new URL(
      await redeemPortAccessLink({
        slug,
      }),
    );
    expect(bootstrapUrl.hostname).toBe(portAccess.host);
    expect(bootstrapUrl.pathname).toBe("/_mistle/access/bootstrap");
    expect(bootstrapUrl.searchParams.get("token")).toMatch(/^[^.]+\.[^.]+\.[^.]+$/u);

    const persistedLink = await env.controlPlaneDb.query.portAccessLinks.findFirst({
      where: (table, { eq }) => eq(table.slug, slug),
    });
    expect(persistedLink).toMatchObject({
      slug,
      organizationId: session.organizationId,
      sandboxInstanceId,
      port: 5173,
      createdByKind: PortAccessLinkCreatedByKinds.USER,
      createdById: session.userId,
    });
  } finally {
    await closeIfOpen(bootstrapSocket);
    await destroyDockerSandboxContainer(providerSandboxId);
    setControlPlaneRequestHeadersForTest(undefined);
    resetDashboardConfigForTest();
    resetControlPlaneApiClientForTest();
  }
});

async function startDockerSandboxContainer(): Promise<string> {
  const { stdout } = await execFileAsync("docker", ["run", "-d", "registry:3"]);
  const containerId = stdout.trim();
  if (containerId.length === 0) {
    throw new Error("Expected docker run to return a container id.");
  }

  return containerId;
}

async function destroyDockerSandboxContainer(containerId: string): Promise<void> {
  await execFileAsync("docker", ["rm", "-f", containerId]).catch(() => undefined);
}

async function attachBootstrapRuntime(input: {
  env: IntegrationTestEnvironment;
  sandboxInstanceId: string;
}): Promise<WebSocket> {
  const websocketBaseUrl = createWebSocketBaseUrl(input.env.dataPlaneGateway.hostBaseUrl);
  const token = await mintBootstrapToken({
    config: {
      bootstrapTokenSecret: BootstrapTokenSecret,
      tokenIssuer: BootstrapTokenIssuer,
      tokenAudience: GatewayTokenAudience,
    },
    jti: randomUUID(),
    sandboxInstanceId: input.sandboxInstanceId,
    ttlSeconds: 120,
  });
  const socket = await connectWebSocket(
    `${websocketBaseUrl}/tunnel/sandbox/${encodeURIComponent(input.sandboxInstanceId)}?bootstrap_token=${encodeURIComponent(token)}`,
    {
      [TestEnvironmentIdHeader]: input.env.id,
    },
  );

  socket.send(
    JSON.stringify({
      type: "runtime.ready",
      ready: true,
    }),
  );

  return socket;
}

function createWebSocketBaseUrl(httpBaseUrl: string): string {
  const url = new URL(httpBaseUrl);
  url.protocol = "ws:";
  return url.toString().replace(/\/$/u, "");
}

function connectWebSocket(url: string, headers: Record<string, string>): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(url, {
      headers,
      handshakeTimeout: 4_000,
    });

    const cleanup = (): void => {
      socket.off("open", onOpen);
      socket.off("error", onError);
      socket.off("unexpected-response", onUnexpectedResponse);
    };
    const onOpen = (): void => {
      cleanup();
      resolve(socket);
    };
    const onError = (error: Error): void => {
      cleanup();
      reject(error);
    };
    const onUnexpectedResponse = (_request: unknown, response: { statusCode: number }): void => {
      cleanup();
      reject(new Error(`Unexpected websocket response status ${String(response.statusCode)}.`));
    };

    socket.once("open", onOpen);
    socket.once("error", onError);
    socket.once("unexpected-response", onUnexpectedResponse);
  });
}

async function waitForGatewayRuntimeReady(
  env: IntegrationTestEnvironment,
  sandboxInstanceId: string,
): Promise<void> {
  const deadline = Date.now() + 4_000;
  let lastSnapshot: unknown;

  while (Date.now() < deadline) {
    const response = await env.dataPlaneGateway.http.fetch(
      `/internal/sandbox-instances/${encodeURIComponent(sandboxInstanceId)}/runtime-state`,
      {
        headers: {
          "x-mistle-service-token": "integration-new-internal-service-token",
          [TestEnvironmentIdHeader]: env.id,
        },
      },
    );

    if (!response.ok) {
      throw new Error(
        `Expected gateway runtime-state response to succeed, got ${String(response.status)}.`,
      );
    }

    lastSnapshot = await response.json();
    if (isRuntimeReadySnapshot(lastSnapshot)) {
      return;
    }

    await systemSleeper.sleep(25);
  }

  throw new Error(
    `Timed out waiting for gateway runtime state to become ready for '${sandboxInstanceId}'. Last snapshot: ${JSON.stringify(lastSnapshot)}`,
  );
}

function isRuntimeReadySnapshot(input: unknown): boolean {
  if (typeof input !== "object" || input === null) {
    return false;
  }

  const runtime = "runtime" in input ? input.runtime : undefined;
  if (typeof runtime !== "object" || runtime === null) {
    return false;
  }

  return "ready" in runtime && runtime.ready === true;
}

async function closeIfOpen(socket: WebSocket | undefined): Promise<void> {
  if (socket === undefined || socket.readyState !== WebSocket.OPEN) {
    return;
  }

  await new Promise<void>((resolve) => {
    socket.once("close", () => {
      resolve();
    });
    socket.close();
  });
}
