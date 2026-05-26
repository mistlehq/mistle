/* eslint-disable jest/no-standalone-expect --
 * The integration harness returns a Vitest fixture-bound `it` function.
 */

import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { promisify } from "node:util";

import { PortAccessLinkCreatedByKinds } from "@mistle/db/control-plane";
import {
  SandboxInstancePurposes,
  SandboxInstanceSources,
  SandboxInstanceStatuses,
  type DataPlaneTables,
} from "@mistle/db/data-plane";
import { mintBootstrapToken } from "@mistle/gateway-tunnel-auth";
import {
  createIntegrationTest,
  TestEnvironmentIdHeader,
  type IntegrationTestEnvironment,
} from "@mistle/test-harness/integration";
import { systemSleeper } from "@mistle/time";
import { eq } from "drizzle-orm";
import { describe, expect } from "vitest";
import WebSocket from "ws";

import { SandboxInstancePortAccessSchema } from "../src/sandbox-instances/index.js";

const execFileAsync = promisify(execFile);
const BootstrapTokenSecret = "integration-new-bootstrap-token-secret";
const BootstrapTokenIssuer = "integration-new-data-plane-worker";
const GatewayTokenAudience = "integration-new-data-plane-gateway";

const it = createIntegrationTest({
  services: ["control-plane-api", "data-plane-api", "data-plane-gateway"],
});

describe.concurrent("sandbox Port Access links integration", () => {
  it("creates a short link for a sandbox port and redirects it to a gateway bootstrap URL", async ({
    env,
  }) => {
    const session = await env.auth.createSession({
      email: "integration-sandbox-port-access-link@example.com",
    });
    const sandboxInstanceId = "sbi_port_access_link";
    const providerSandboxId = await startDockerSandboxContainer();
    let bootstrapSocket: WebSocket | undefined;

    try {
      await insertSandboxInstance(env, {
        organizationId: session.organizationId,
        sandboxInstanceId,
        providerSandboxId,
      });
      bootstrapSocket = await attachBootstrapRuntime({
        env,
        sandboxInstanceId,
      });
      await waitForGatewayRuntimeReady(env, sandboxInstanceId);

      const createResponse = await env.controlPlaneApi.http.fetch(
        `/v1/sandbox/instances/${sandboxInstanceId}/ports/4173/access`,
        {
          method: "POST",
          headers: {
            cookie: session.cookie,
            host: "attacker.example.test",
          },
        },
      );

      expect(createResponse.status).toBe(201);
      const portAccess = SandboxInstancePortAccessSchema.parse(await createResponse.json());
      const url = new URL(portAccess.url);
      const slug = url.pathname.replace("/p/ports/", "");

      expect(url.hostname).not.toBe("attacker.example.test");
      expect(slug).toMatch(/^[0-9A-Za-z]{12}$/u);
      expect(portAccess.host).toContain("p-4173--");
      expect(Date.parse(portAccess.expiresAt)).toBeGreaterThan(
        Date.now() + 6 * 24 * 60 * 60 * 1000,
      );

      const persistedLink = await env.controlPlaneDb.query.portAccessLinks.findFirst({
        where: (table, { eq }) => eq(table.slug, slug),
      });
      expect(persistedLink).toMatchObject({
        slug,
        organizationId: session.organizationId,
        sandboxInstanceId,
        port: 4173,
        createdByKind: PortAccessLinkCreatedByKinds.USER,
        createdById: session.userId,
      });
      expect(Date.parse(persistedLink?.expiresAt ?? "")).toBe(Date.parse(portAccess.expiresAt));

      const redirectResponse = await env.controlPlaneApi.http.fetch(`/p/ports/${slug}`, {
        redirect: "manual",
        headers: {
          cookie: session.cookie,
        },
      });

      expect(redirectResponse.status).toBe(302);
      const location = redirectResponse.headers.get("location");
      expect(location).not.toBeNull();
      const redirectUrl = new URL(location ?? "");
      expect(redirectUrl.hostname).toBe(portAccess.host);
      expect(redirectUrl.port).not.toBe("");
      expect(redirectUrl.pathname).toBe("/_mistle/access/bootstrap");
      expect(redirectUrl.searchParams.get("token")).toMatch(/^[^.]+\.[^.]+\.[^.]+$/u);
    } finally {
      await closeIfOpen(bootstrapSocket);
      await destroyDockerSandboxContainer(providerSandboxId);
    }
  });

  it("reuses an active short link for the same sandbox port", async ({ env }) => {
    const session = await env.auth.createSession({
      email: "integration-sandbox-port-access-link-reuse@example.com",
    });

    await insertSandboxInstance(env, {
      organizationId: session.organizationId,
      sandboxInstanceId: "sbi_port_access_link_reuse",
    });

    const firstCreateResponse = await env.controlPlaneApi.http.fetch(
      "/v1/sandbox/instances/sbi_port_access_link_reuse/ports/4173/access",
      {
        method: "POST",
        headers: {
          cookie: session.cookie,
        },
      },
    );
    const secondCreateResponse = await env.controlPlaneApi.http.fetch(
      "/v1/sandbox/instances/sbi_port_access_link_reuse/ports/4173/access",
      {
        method: "POST",
        headers: {
          cookie: session.cookie,
        },
      },
    );

    expect(firstCreateResponse.status).toBe(201);
    expect(secondCreateResponse.status).toBe(201);
    const firstPortAccess = SandboxInstancePortAccessSchema.parse(await firstCreateResponse.json());
    const secondPortAccess = SandboxInstancePortAccessSchema.parse(
      await secondCreateResponse.json(),
    );

    expect(secondPortAccess).toEqual(firstPortAccess);

    const persistedLinks = await env.controlPlaneDb.query.portAccessLinks.findMany({
      where: (table, { and, eq }) =>
        and(
          eq(table.organizationId, session.organizationId),
          eq(table.sandboxInstanceId, "sbi_port_access_link_reuse"),
          eq(table.port, 4173),
        ),
    });
    expect(persistedLinks).toHaveLength(1);
  });

  it("does not reuse active short links created by a different actor", async ({ env }) => {
    const session = await env.auth.createSession({
      email: "integration-sandbox-port-access-link-creator-reuse@example.com",
    });
    const sandboxInstanceId = "sbi_port_access_link_creator_reuse";

    await insertSandboxInstance(env, {
      organizationId: session.organizationId,
      sandboxInstanceId,
    });
    await env.controlPlaneDb.insert(env.controlPlaneTables.portAccessLinks).values({
      slug: "AgentReuse01",
      organizationId: session.organizationId,
      sandboxInstanceId,
      port: 4173,
      createdByKind: PortAccessLinkCreatedByKinds.AGENT,
      createdById: "apk_port_access_link_creator_reuse",
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
    });

    const createResponse = await env.controlPlaneApi.http.fetch(
      `/v1/sandbox/instances/${sandboxInstanceId}/ports/4173/access`,
      {
        method: "POST",
        headers: {
          cookie: session.cookie,
        },
      },
    );

    expect(createResponse.status).toBe(201);
    const portAccess = SandboxInstancePortAccessSchema.parse(await createResponse.json());
    const slug = new URL(portAccess.url).pathname.replace("/p/ports/", "");
    expect(slug).not.toBe("AgentReuse01");

    const persistedLinks = await env.controlPlaneDb.query.portAccessLinks.findMany({
      where: (table, { and, eq }) =>
        and(
          eq(table.organizationId, session.organizationId),
          eq(table.sandboxInstanceId, sandboxInstanceId),
          eq(table.port, 4173),
        ),
    });
    expect(persistedLinks).toHaveLength(2);
    expect(persistedLinks).toContainEqual(
      expect.objectContaining({
        slug,
        createdByKind: PortAccessLinkCreatedByKinds.USER,
        createdById: session.userId,
      }),
    );
  });

  it("does not reuse active short links created by a different actor with the same kind", async ({
    env,
  }) => {
    const session = await env.auth.createSession({
      email: "integration-sandbox-port-access-link-same-kind-creator-reuse@example.com",
    });
    const sandboxInstanceId = "sbi_port_access_link_same_kind_creator_reuse";

    await insertSandboxInstance(env, {
      organizationId: session.organizationId,
      sandboxInstanceId,
    });
    await env.controlPlaneDb.insert(env.controlPlaneTables.portAccessLinks).values({
      slug: "UserReuse001",
      organizationId: session.organizationId,
      sandboxInstanceId,
      port: 4173,
      createdByKind: PortAccessLinkCreatedByKinds.USER,
      createdById: "usr_port_access_link_other_creator",
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
    });

    const createResponse = await env.controlPlaneApi.http.fetch(
      `/v1/sandbox/instances/${sandboxInstanceId}/ports/4173/access`,
      {
        method: "POST",
        headers: {
          cookie: session.cookie,
        },
      },
    );

    expect(createResponse.status).toBe(201);
    const portAccess = SandboxInstancePortAccessSchema.parse(await createResponse.json());
    const slug = new URL(portAccess.url).pathname.replace("/p/ports/", "");
    expect(slug).not.toBe("UserReuse001");

    const persistedLinks = await env.controlPlaneDb.query.portAccessLinks.findMany({
      where: (table, { and, eq }) =>
        and(
          eq(table.organizationId, session.organizationId),
          eq(table.sandboxInstanceId, sandboxInstanceId),
          eq(table.port, 4173),
        ),
    });
    expect(persistedLinks).toHaveLength(2);
    expect(persistedLinks).toContainEqual(
      expect.objectContaining({
        slug,
        createdByKind: PortAccessLinkCreatedByKinds.USER,
        createdById: session.userId,
      }),
    );
  });

  it("does not redirect expired short links", async ({ env }) => {
    const session = await env.auth.createSession({
      email: "integration-sandbox-port-access-link-expired@example.com",
    });
    await insertSandboxInstance(env, {
      organizationId: session.organizationId,
      sandboxInstanceId: "sbi_port_access_link_expired",
    });

    await env.controlPlaneDb.insert(env.controlPlaneTables.portAccessLinks).values({
      slug: "Expired00001",
      organizationId: session.organizationId,
      sandboxInstanceId: "sbi_port_access_link_expired",
      port: 4173,
      createdByKind: PortAccessLinkCreatedByKinds.USER,
      createdById: session.userId,
      expiresAt: "2026-01-01T00:00:00.000Z",
    });

    const redirectResponse = await env.controlPlaneApi.http.fetch("/p/ports/Expired00001", {
      redirect: "manual",
      headers: {
        cookie: session.cookie,
      },
    });

    expect(redirectResponse.status).toBe(404);
    expect(await redirectResponse.json()).toEqual({
      code: "NOT_FOUND",
      message: "Port Access link was not found or has expired.",
    });
  });

  it("does not redeem short links outside the active organization", async ({ env }) => {
    const linkOwnerSession = await env.auth.createSession({
      email: "integration-sandbox-port-access-link-owner@example.com",
    });
    const otherSession = await env.auth.createSession({
      email: "integration-sandbox-port-access-link-other-org@example.com",
    });
    await insertSandboxInstance(env, {
      organizationId: linkOwnerSession.organizationId,
      sandboxInstanceId: "sbi_port_access_link_other_org",
    });

    const createResponse = await env.controlPlaneApi.http.fetch(
      "/v1/sandbox/instances/sbi_port_access_link_other_org/ports/4173/access",
      {
        method: "POST",
        headers: {
          cookie: linkOwnerSession.cookie,
        },
      },
    );
    const portAccess = SandboxInstancePortAccessSchema.parse(await createResponse.json());
    const slug = new URL(portAccess.url).pathname.replace("/p/ports/", "");

    const redirectResponse = await env.controlPlaneApi.http.fetch(`/p/ports/${slug}`, {
      redirect: "manual",
      headers: {
        cookie: otherSession.cookie,
      },
    });

    expect(redirectResponse.status).toBe(404);
    expect(await redirectResponse.json()).toEqual({
      code: "NOT_FOUND",
      message: "Port Access link was not found or has expired.",
    });
  });

  it("does not redeem short links after the sandbox instance is deleted", async ({ env }) => {
    const session = await env.auth.createSession({
      email: "integration-sandbox-port-access-link-deleted-instance@example.com",
    });
    const sandboxInstanceId = "sbi_port_access_link_deleted_instance";
    await insertSandboxInstance(env, {
      organizationId: session.organizationId,
      sandboxInstanceId,
    });

    const createResponse = await env.controlPlaneApi.http.fetch(
      `/v1/sandbox/instances/${sandboxInstanceId}/ports/4173/access`,
      {
        method: "POST",
        headers: {
          cookie: session.cookie,
        },
      },
    );
    const portAccess = SandboxInstancePortAccessSchema.parse(await createResponse.json());
    const slug = new URL(portAccess.url).pathname.replace("/p/ports/", "");

    await env.dataPlaneDb
      .delete(env.dataPlaneTables.sandboxInstances)
      .where(eq(env.dataPlaneTables.sandboxInstances.id, sandboxInstanceId));

    const redirectResponse = await env.controlPlaneApi.http.fetch(`/p/ports/${slug}`, {
      redirect: "manual",
      headers: {
        cookie: session.cookie,
      },
    });

    expect(redirectResponse.status).toBe(404);
    expect(redirectResponse.headers.get("location")).toBeNull();
    expect(await redirectResponse.json()).toEqual({
      code: "NOT_FOUND",
      message: "Port Access link was not found or has expired.",
    });
  });

  it("does not redeem short links for sandbox instances that are not connectable", async ({
    env,
  }) => {
    const session = await env.auth.createSession({
      email: "integration-sandbox-port-access-link-stopped-instance@example.com",
    });
    const sandboxInstanceId = "sbi_port_access_link_stopped_instance";
    await insertSandboxInstance(env, {
      organizationId: session.organizationId,
      sandboxInstanceId,
      status: SandboxInstanceStatuses.STOPPED,
    });

    const createResponse = await env.controlPlaneApi.http.fetch(
      `/v1/sandbox/instances/${sandboxInstanceId}/ports/4173/access`,
      {
        method: "POST",
        headers: {
          cookie: session.cookie,
        },
      },
    );
    const portAccess = SandboxInstancePortAccessSchema.parse(await createResponse.json());
    const slug = new URL(portAccess.url).pathname.replace("/p/ports/", "");

    const redirectResponse = await env.controlPlaneApi.http.fetch(`/p/ports/${slug}`, {
      redirect: "manual",
      headers: {
        cookie: session.cookie,
      },
    });

    expect(redirectResponse.status).toBe(409);
    expect(redirectResponse.headers.get("location")).toBeNull();
    expect(await redirectResponse.json()).toEqual({
      code: "INSTANCE_FAILED",
      message: `Sandbox instance '${sandboxInstanceId}' failed and cannot be connected: Sandbox runtime was not found at the provider during inspection.`,
    });
  });

  it("requires an authenticated active organization to redeem short links", async ({ env }) => {
    const redirectResponse = await env.controlPlaneApi.http.fetch("/p/ports/Unknown000001", {
      redirect: "manual",
    });

    expect(redirectResponse.status).toBe(401);
    expect(await redirectResponse.json()).toEqual({
      code: "UNAUTHORIZED",
      message: "Unauthorized API request.",
    });
  });
});

type SandboxInstanceRow = DataPlaneTables["sandboxInstances"]["$inferInsert"];

async function insertSandboxInstance(
  env: IntegrationTestEnvironment,
  input: {
    organizationId: string;
    sandboxInstanceId: string;
    status?: SandboxInstanceRow["status"];
    providerSandboxId?: string;
  },
): Promise<void> {
  await env.dataPlaneDb.insert(env.dataPlaneTables.sandboxInstances).values({
    id: input.sandboxInstanceId,
    organizationId: input.organizationId,
    sandboxProfileId: `sbp_${input.sandboxInstanceId}`,
    sandboxProfileVersion: 1,
    runtimeProvider: "docker",
    providerSandboxId: input.providerSandboxId ?? `provider-${input.sandboxInstanceId}`,
    status: input.status ?? SandboxInstanceStatuses.RUNNING,
    startedByKind: "user",
    startedById: "usr_port_access_link",
    source: SandboxInstanceSources.DASHBOARD,
    purpose: SandboxInstancePurposes.SESSION,
    failureCode: null,
    failureMessage: null,
  } satisfies SandboxInstanceRow);
}

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
