/* eslint-disable jest/no-standalone-expect --
 * The integration harness returns a Vitest fixture-bound `it` function.
 */

import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { promisify } from "node:util";

import { SandboxInstancePersistenceModes, SandboxInstanceStatuses } from "@mistle/db/data-plane";
import { mintBootstrapToken } from "@mistle/gateway-tunnel-auth";
import {
  TestEnvironmentIdHeader,
  createIntegrationTest,
  type IntegrationTestEnvironment,
} from "@mistle/test-harness/integration";
import { systemSleeper } from "@mistle/time";
import { describe, expect } from "vitest";
import WebSocket from "ws";

import {
  SandboxInstanceConnectionTokenSchema,
  SandboxInstancesConflictResponseSchema,
} from "../src/sandbox-instances/index.js";

const execFileAsync = promisify(execFile);

const BootstrapTokenSecret = "integration-new-bootstrap-token-secret";
const BootstrapTokenIssuer = "integration-new-data-plane-worker";
const GatewayTokenAudience = "integration-new-data-plane-gateway";

const it = createIntegrationTest({
  services: ["control-plane-api", "data-plane-api", "data-plane-gateway"],
});

describe.concurrent("sandbox instance connect integration", () => {
  it("mints a connection token for a running sandbox with an attached runtime", async ({ env }) => {
    const session = await env.auth.createSession({
      email: "integration-new-sandbox-connect-running@example.com",
    });
    const sandboxInstanceId = "sbi_cp_connect_running_001";
    const providerSandboxId = await startDockerSandboxContainer();
    let bootstrapSocket: WebSocket | undefined;

    try {
      await insertSandboxInstance(env, {
        organizationId: session.organizationId,
        sandboxInstanceId,
        providerSandboxId,
        status: SandboxInstanceStatuses.RUNNING,
        startedById: session.userId,
      });
      bootstrapSocket = await attachBootstrapRuntime({
        environmentId: env.id,
        gatewayBaseUrl: env.dataPlaneGateway.hostBaseUrl,
        sandboxInstanceId,
      });
      await waitForGatewayRuntimeReady(env, sandboxInstanceId);

      const response = await env.controlPlaneApi.http.fetch(
        `/v1/sandbox/instances/${sandboxInstanceId}/connection-tokens`,
        {
          method: "POST",
          headers: {
            cookie: session.cookie,
          },
        },
      );

      expect(response.status).toBe(201);
      const body = SandboxInstanceConnectionTokenSchema.parse(await response.json());
      expect(body.instanceId).toBe(sandboxInstanceId);
      expect(body.url).toContain(`/tunnel/sandbox/${sandboxInstanceId}?`);
      expect(body.token).not.toBe("");
      expect(new Date(body.expiresAt).getTime()).toBeGreaterThan(Date.now());
    } finally {
      await closeIfOpen(bootstrapSocket);
      await destroyDockerSandboxContainer(providerSandboxId);
    }
  });

  it("returns INSTANCE_FAILED when a persisted running sandbox is missing at the provider", async ({
    env,
  }) => {
    const session = await env.auth.createSession({
      email: "integration-new-sandbox-connect-missing-provider@example.com",
    });
    const sandboxInstanceId = "sbi_cp_connect_missing_provider_001";
    const providerSandboxId = await startDockerSandboxContainer();

    await insertSandboxInstance(env, {
      organizationId: session.organizationId,
      sandboxInstanceId,
      providerSandboxId,
      status: SandboxInstanceStatuses.RUNNING,
      startedById: session.userId,
      persistenceMode: SandboxInstancePersistenceModes.EPHEMERAL,
    });
    await destroyDockerSandboxContainer(providerSandboxId);

    const response = await env.controlPlaneApi.http.fetch(
      `/v1/sandbox/instances/${sandboxInstanceId}/connection-tokens`,
      {
        method: "POST",
        headers: {
          cookie: session.cookie,
        },
      },
    );

    expect(response.status).toBe(409);
    const body = SandboxInstancesConflictResponseSchema.parse(await response.json());
    expect(body.code).toBe("INSTANCE_FAILED");
    expect(body.message).toContain("Sandbox runtime was not found at the provider");

    const persistedInstance = await env.dataPlaneDb.query.sandboxInstances.findFirst({
      where: (table, { eq }) => eq(table.id, sandboxInstanceId),
    });
    expect(persistedInstance?.status).toBe(SandboxInstanceStatuses.FAILED);
  });

  it("returns INSTANCE_NOT_RESUMABLE for pending and stopped instances", async ({ env }) => {
    const session = await env.auth.createSession({
      email: "integration-new-sandbox-connect-not-resumable@example.com",
    });
    await insertSandboxInstance(env, {
      organizationId: session.organizationId,
      sandboxInstanceId: "sbi_cp_connect_pending_001",
      providerSandboxId: null,
      status: SandboxInstanceStatuses.PENDING,
      startedById: session.userId,
    });
    await insertSandboxInstance(env, {
      organizationId: session.organizationId,
      sandboxInstanceId: "sbi_cp_connect_stopped_001",
      providerSandboxId: null,
      status: SandboxInstanceStatuses.STOPPED,
      startedById: session.userId,
    });

    const pendingResponse = await env.controlPlaneApi.http.fetch(
      "/v1/sandbox/instances/sbi_cp_connect_pending_001/connection-tokens",
      {
        method: "POST",
        headers: {
          cookie: session.cookie,
        },
      },
    );
    expect(pendingResponse.status).toBe(409);
    const pendingBody = SandboxInstancesConflictResponseSchema.parse(await pendingResponse.json());
    expect(pendingBody.code).toBe("INSTANCE_NOT_RESUMABLE");
    expect(pendingBody.message).toContain("is 'pending' and is not connectable");

    const stoppedResponse = await env.controlPlaneApi.http.fetch(
      "/v1/sandbox/instances/sbi_cp_connect_stopped_001/connection-tokens",
      {
        method: "POST",
        headers: {
          cookie: session.cookie,
        },
      },
    );
    expect(stoppedResponse.status).toBe(409);
    const stoppedBody = SandboxInstancesConflictResponseSchema.parse(await stoppedResponse.json());
    expect(stoppedBody.code).toBe("INSTANCE_NOT_RESUMABLE");
    expect(stoppedBody.message).toContain("is 'stopped' and is not connectable");
  });

  it("returns INSTANCE_FAILED for failed instances", async ({ env }) => {
    const session = await env.auth.createSession({
      email: "integration-new-sandbox-connect-failed@example.com",
    });
    await insertSandboxInstance(env, {
      organizationId: session.organizationId,
      sandboxInstanceId: "sbi_cp_connect_failed_001",
      providerSandboxId: null,
      status: SandboxInstanceStatuses.FAILED,
      startedById: session.userId,
      failureCode: "sandbox_start_failed",
      failureMessage: "Sandbox runtime failed to start.",
    });

    const response = await env.controlPlaneApi.http.fetch(
      "/v1/sandbox/instances/sbi_cp_connect_failed_001/connection-tokens",
      {
        method: "POST",
        headers: {
          cookie: session.cookie,
        },
      },
    );

    expect(response.status).toBe(409);
    const body = SandboxInstancesConflictResponseSchema.parse(await response.json());
    expect(body.code).toBe("INSTANCE_FAILED");
    expect(body.message).toContain("Sandbox runtime failed to start.");
  });
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
  environmentId: string;
  gatewayBaseUrl: string;
  sandboxInstanceId: string;
}): Promise<WebSocket> {
  const websocketBaseUrl = createWebSocketBaseUrl(input.gatewayBaseUrl);
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
      [TestEnvironmentIdHeader]: input.environmentId,
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
    const onUnexpectedResponse = (
      _request: unknown,
      response: {
        statusCode?: number;
      },
    ): void => {
      cleanup();
      reject(
        Object.assign(new Error("WebSocket upgrade failed."), {
          statusCode: response.statusCode,
        }),
      );
    };

    socket.once("open", onOpen);
    socket.once("error", onError);
    socket.once("unexpected-response", onUnexpectedResponse);
  });
}

async function closeIfOpen(socket: WebSocket | undefined): Promise<void> {
  if (socket === undefined || socket.readyState !== WebSocket.OPEN) {
    return;
  }

  await new Promise<void>((resolve, reject) => {
    socket.once("close", () => {
      resolve();
    });
    socket.once("error", (error) => {
      reject(error);
    });
    socket.close();
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

async function insertSandboxInstance(
  env: IntegrationTestEnvironment,
  input: {
    organizationId: string;
    sandboxInstanceId: string;
    providerSandboxId: string | null;
    persistenceMode?:
      | typeof SandboxInstancePersistenceModes.EPHEMERAL
      | typeof SandboxInstancePersistenceModes.PERSISTENT;
    status:
      | typeof SandboxInstanceStatuses.PENDING
      | typeof SandboxInstanceStatuses.RUNNING
      | typeof SandboxInstanceStatuses.STOPPED
      | typeof SandboxInstanceStatuses.FAILED;
    startedById: string;
    failureCode?: string;
    failureMessage?: string;
  },
): Promise<void> {
  await env.dataPlaneDb.insert(env.dataPlaneTables.sandboxInstances).values({
    id: input.sandboxInstanceId,
    organizationId: input.organizationId,
    sandboxProfileId: "sbp_connect_integration",
    title: null,
    sandboxProfileVersion: 1,
    runtimeProvider: "docker",
    providerSandboxId: input.providerSandboxId,
    persistenceMode: input.persistenceMode ?? SandboxInstancePersistenceModes.PERSISTENT,
    status: input.status,
    startedByKind: "user",
    startedById: input.startedById,
    source: "dashboard",
    failureCode: input.failureCode ?? null,
    failureMessage: input.failureMessage ?? null,
  });
}
