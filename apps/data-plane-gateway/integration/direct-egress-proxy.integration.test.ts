/* eslint-disable jest/no-standalone-expect --
 * The integration harness returns a Vitest fixture-bound `it` function.
 */

import { randomUUID } from "node:crypto";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";

import { IntegrationBindingKinds } from "@mistle/db/control-plane";
import { SandboxInstanceStatuses } from "@mistle/db/data-plane";
import { mintEgressToken } from "@mistle/gateway-tunnel-auth";
import type { CompiledRuntimePlan } from "@mistle/sandbox-runtime-contract";
import {
  TestEnvironmentIdHeader,
  createIntegrationTest,
  type IntegrationTestEnvironment,
} from "@mistle/test-harness/integration";
import { systemScheduler, type TimerHandle } from "@mistle/time";
import { typeid } from "typeid-js";
import { describe, expect } from "vitest";
import WebSocket, { WebSocketServer } from "ws";

import {
  DirectEgressHttpRoutePath,
  DirectEgressWebSocketRoutePath,
} from "../src/egress/direct-egress-proxy-service.js";
import {
  closeWebSocket,
  connectWebSocket,
  connectWebSocketExpectFailure,
  waitForWebSocketMessage,
} from "./websocket-test-helpers.js";

const StepTimeoutMs = 5_000;
const TestTimeoutMs = 45_000;
const EgressTokenSecret = "integration-new-egress-token-secret";
const EgressTokenIssuer = "integration-new-data-plane-gateway";
const EgressTokenAudience = "integration-new-gateway-egress";

const it = createIntegrationTest({
  services: ["control-plane-api", "data-plane-api", "data-plane-gateway"],
});

type ReceivedHttpRequest = {
  body: string;
  headers: IncomingMessage["headers"];
  method: string;
  url: string;
};

type SimulatedHttpUpstream = {
  baseUrl: string;
  close: () => Promise<void>;
  nextRequest: () => Promise<ReceivedHttpRequest>;
};

type SimulatedWebSocketUpstream = {
  baseUrl: string;
  close: () => Promise<void>;
  nextConnection: () => Promise<void>;
};

describe.concurrent("direct egress proxy integration", () => {
  it(
    "proxies authorized HTTP requests directly to unmatched upstreams",
    async ({ env }) => {
      const sandboxInstanceId = typeid("sbi").toString();
      const upstream = await startSimulatedHttpUpstream();
      await insertSandboxInstanceRow({
        env,
        sandboxInstanceId,
      });

      try {
        const target = new URL("/packages/mistle.tgz?checksum=123", upstream.baseUrl);
        const response = await env.dataPlaneGateway.http.fetch(
          `${DirectEgressHttpRoutePath}?target=${encodeURIComponent(target.toString())}`,
          {
            method: "POST",
            headers: {
              authorization: `Bearer ${await mintDirectEgressToken({
                organizationId: "org_integration_direct_egress",
                sandboxInstanceId,
              })}`,
              "content-type": "text/plain; charset=utf-8",
              "x-direct-egress-marker": "http",
            },
            body: "hello direct egress",
          },
        );

        expect(response.status).toBe(202);
        expect(response.headers.get("x-upstream-marker")).toBe("simulated-http");
        await expect(response.text()).resolves.toBe("hello from upstream");

        const request = await withTimeout({
          label: "waiting for simulated direct HTTP upstream request",
          promise: upstream.nextRequest(),
        });
        expect(request).toEqual({
          body: "hello direct egress",
          headers: expect.objectContaining({
            "content-type": "text/plain; charset=utf-8",
            "x-direct-egress-marker": "http",
          }),
          method: "POST",
          url: "/packages/mistle.tgz?checksum=123",
        });
        expect(request.headers.authorization).toBeUndefined();
      } finally {
        await upstream.close();
      }
    },
    TestTimeoutMs,
  );

  it(
    "resolves integration credentials for matched managed HTTP routes before forwarding upstream",
    async ({ env }) => {
      const sandboxInstanceId = typeid("sbi").toString();
      const upstream = await startSimulatedHttpUpstream();
      const binding = await createDatadogBinding({
        env,
        uniqueId: randomUUID().replaceAll("-", ""),
      });
      const upstreamUrl = new URL("/mcp", upstream.baseUrl);
      await insertSandboxInstanceRow({
        env,
        organizationId: binding.organizationId,
        sandboxInstanceId,
        runtimePlan: createRuntimePlan({
          egressRoutes: [
            createRoute({
              additionalCredentialHeaders: [
                {
                  header: "dd_application_key",
                  credentialResolver: {
                    kind: "integration_connection",
                    connectionId: binding.connectionId,
                    secretType: "api_key",
                    slotKey: "datadog.datadog-default.api-key.application-key",
                  },
                },
              ],
              authInjection: {
                type: "header",
                target: "dd_api_key",
              },
              bindingId: binding.bindingId,
              connectionId: binding.connectionId,
              egressRuleId: "egress_rule_direct_datadog",
              familyId: "datadog",
              hosts: [upstreamUrl.hostname],
              methods: ["POST"],
              pathPrefixes: ["/mcp"],
              secretType: "api_key",
              slotKey: "datadog.datadog-default.api-key.api-key",
              upstreamBaseUrl: upstream.baseUrl,
              variantId: "datadog-default",
            }),
          ],
        }),
      });

      try {
        const response = await env.dataPlaneGateway.http.fetch(
          `${DirectEgressHttpRoutePath}?target=${encodeURIComponent(upstreamUrl.toString())}`,
          {
            method: "POST",
            headers: {
              authorization: `Bearer ${await mintDirectEgressToken({
                organizationId: binding.organizationId,
                sandboxInstanceId,
              })}`,
              "content-type": "text/plain",
              "x-sandbox-header": "preserved",
            },
            body: "managed-body",
          },
        );

        expect(response.status).toBe(202);
        await expect(response.text()).resolves.toBe("hello from upstream");

        const request = await withTimeout({
          label: "waiting for managed direct egress upstream request",
          promise: upstream.nextRequest(),
        });

        expect(request.method).toBe("POST");
        expect(request.url).toBe("/mcp");
        expect(request.body).toBe("managed-body");
        expect(request.headers["dd_api_key"]).toBe("datadog-api-key");
        expect(request.headers["dd_application_key"]).toBe("datadog-application-key");
        expect(request.headers["x-sandbox-header"]).toBe("preserved");
        expect(request.headers.authorization).toBeUndefined();
      } finally {
        await upstream.close();
      }
    },
    TestTimeoutMs,
  );

  it(
    "rejects direct HTTP proxy requests with invalid egress tokens",
    async ({ env }) => {
      const upstream = await startSimulatedHttpUpstream();

      try {
        const target = new URL("/private", upstream.baseUrl);
        const response = await env.dataPlaneGateway.http.fetch(
          `${DirectEgressHttpRoutePath}?target=${encodeURIComponent(target.toString())}`,
          {
            headers: {
              authorization: "Bearer not-a-valid-token",
            },
          },
        );

        expect(response.status).toBe(401);
        await expect(response.text()).resolves.toContain("Direct egress token verification failed");
      } finally {
        await upstream.close();
      }
    },
    TestTimeoutMs,
  );

  it(
    "proxies authorized websocket connections directly to unmatched upstreams",
    async ({ env }) => {
      const sandboxInstanceId = typeid("sbi").toString();
      const upstream = await startSimulatedWebSocketUpstream();
      await insertSandboxInstanceRow({
        env,
        sandboxInstanceId,
      });
      const gatewayWebSocketUrl = new URL(
        DirectEgressWebSocketRoutePath,
        env.dataPlaneGateway.hostBaseUrl,
      );
      gatewayWebSocketUrl.protocol = "ws:";
      gatewayWebSocketUrl.searchParams.set("target", `${upstream.baseUrl}/socket?room=blue`);
      const socket = await connectWebSocket(gatewayWebSocketUrl.toString(), {
        headers: {
          [TestEnvironmentIdHeader]: env.id,
          authorization: `Bearer ${await mintDirectEgressToken({
            organizationId: "org_integration_direct_egress",
            sandboxInstanceId,
          })}`,
        },
      });

      try {
        socket.send("hello websocket");
        await withTimeout({
          label: "waiting for simulated direct websocket upstream connection",
          promise: upstream.nextConnection(),
        });

        await expect(
          withTimeout({
            label: "waiting for direct websocket echo",
            promise: waitForWebSocketMessage(socket),
          }),
        ).resolves.toEqual({
          data: "echo:hello websocket",
          isBinary: false,
        });
      } finally {
        await closeIfOpen(socket);
        await upstream.close();
      }
    },
    TestTimeoutMs,
  );

  it(
    "rejects direct websocket proxy upgrades with invalid egress tokens",
    async ({ env }) => {
      const upstream = await startSimulatedWebSocketUpstream();

      try {
        const gatewayWebSocketUrl = new URL(
          DirectEgressWebSocketRoutePath,
          env.dataPlaneGateway.hostBaseUrl,
        );
        gatewayWebSocketUrl.protocol = "ws:";
        gatewayWebSocketUrl.searchParams.set("target", `${upstream.baseUrl}/socket`);

        await expect(
          connectWebSocketExpectFailure(gatewayWebSocketUrl.toString(), {
            headers: {
              [TestEnvironmentIdHeader]: env.id,
              authorization: "Bearer not-a-valid-token",
            },
          }),
        ).resolves.toEqual({
          error: expect.any(Error),
          responseStatusCode: 401,
        });
      } finally {
        await upstream.close();
      }
    },
    TestTimeoutMs,
  );
});

async function insertSandboxInstanceRow(input: {
  env: IntegrationTestEnvironment;
  organizationId?: string;
  runtimePlan?: CompiledRuntimePlan;
  sandboxInstanceId: string;
}): Promise<void> {
  await input.env.dataPlaneDb.insert(input.env.dataPlaneTables.sandboxInstances).values({
    id: input.sandboxInstanceId,
    organizationId: input.organizationId ?? "org_integration_direct_egress",
    sandboxProfileId: "sbp_integration_direct_egress",
    sandboxProfileVersion: 1,
    runtimeProvider: "docker",
    providerSandboxId: `provider-${input.sandboxInstanceId}`,
    status: SandboxInstanceStatuses.STARTING,
    startedByKind: "system",
    startedById: "workflow_integration_direct_egress",
    source: "webhook",
  });

  await input.env.dataPlaneDb.insert(input.env.dataPlaneTables.sandboxInstanceRuntimePlans).values({
    sandboxInstanceId: input.sandboxInstanceId,
    revision: 1,
    compiledRuntimePlan: input.runtimePlan ?? createRuntimePlan({ egressRoutes: [] }),
    compiledFromProfileId: "sbp_integration_direct_egress",
    compiledFromProfileVersion: 1,
  });
}

function createRuntimePlan(input: {
  egressRoutes: CompiledRuntimePlan["egressRoutes"];
}): CompiledRuntimePlan {
  return {
    sandboxProfileId: "sbp_integration_direct_egress",
    version: 1,
    image: {
      source: "base",
      imageRef: "sandbox-base",
    },
    egressRoutes: input.egressRoutes,
    artifacts: [],
    workspaceSources: [],
    runtimeClients: [],
    agentRuntimes: [],
  };
}

function createRoute(input: {
  additionalCredentialHeaders?: CompiledRuntimePlan["egressRoutes"][number]["additionalCredentialHeaders"];
  authInjection?: CompiledRuntimePlan["egressRoutes"][number]["authInjection"];
  bindingId?: string;
  connectionId?: string;
  credentialResolver?: CompiledRuntimePlan["egressRoutes"][number]["credentialResolver"];
  egressRuleId: string;
  familyId?: string;
  hosts: string[];
  pathPrefixes?: string[];
  methods?: string[];
  secretType?: string;
  slotKey?: string;
  upstreamBaseUrl?: string;
  variantId?: string;
}): CompiledRuntimePlan["egressRoutes"][number] {
  return {
    egressRuleId: input.egressRuleId,
    bindingId: input.bindingId ?? `bind_${input.egressRuleId}`,
    familyId: input.familyId ?? "openai",
    variantId: input.variantId ?? "openai-default",
    match: {
      hosts: input.hosts,
      ...(input.pathPrefixes === undefined ? {} : { pathPrefixes: input.pathPrefixes }),
      ...(input.methods === undefined ? {} : { methods: input.methods }),
    },
    upstream: {
      baseUrl: input.upstreamBaseUrl ?? `https://${input.hosts[0]}`,
    },
    authInjection: input.authInjection ?? {
      type: "bearer",
      target: "authorization",
    },
    credentialResolver: {
      kind: "integration_connection",
      connectionId: input.connectionId ?? "ic_openai",
      secretType: input.secretType ?? "api_token",
      ...(input.slotKey === undefined ? {} : { slotKey: input.slotKey }),
    },
    ...(input.additionalCredentialHeaders === undefined
      ? {}
      : { additionalCredentialHeaders: input.additionalCredentialHeaders }),
    ...(input.credentialResolver === undefined
      ? {}
      : { credentialResolver: input.credentialResolver }),
  };
}

async function createDatadogBinding(input: {
  env: IntegrationTestEnvironment;
  uniqueId: string;
}): Promise<{
  bindingId: string;
  connectionId: string;
  organizationId: string;
}> {
  const session = await input.env.auth.createSession({
    email: `${input.uniqueId}@example.com`,
  });
  const targetKey = `datadog_${input.uniqueId}`;
  const bindingId = `ibd_${input.uniqueId}`;
  const sandboxProfileId = `sbp_${input.uniqueId}`;
  const connectionId = await createDatadogConnection({
    cookie: session.cookie,
    env: input.env,
    targetKey,
  });

  await input.env.controlPlaneDb.insert(input.env.controlPlaneTables.sandboxProfiles).values({
    id: sandboxProfileId,
    organizationId: session.organizationId,
    displayName: "Direct egress Datadog integration profile",
  });
  await input.env.controlPlaneDb
    .insert(input.env.controlPlaneTables.sandboxProfileVersions)
    .values({
      sandboxProfileId,
      version: 1,
    });
  await input.env.controlPlaneDb
    .insert(input.env.controlPlaneTables.sandboxProfileVersionIntegrationBindings)
    .values({
      id: bindingId,
      sandboxProfileId,
      sandboxProfileVersion: 1,
      connectionId,
      kind: IntegrationBindingKinds.AGENT,
      config: {},
    });

  return {
    bindingId,
    connectionId,
    organizationId: session.organizationId,
  };
}

async function createDatadogConnection(input: {
  cookie: string;
  env: IntegrationTestEnvironment;
  targetKey: string;
}): Promise<string> {
  await input.env.controlPlaneDb
    .insert(input.env.controlPlaneTables.integrationTargets)
    .values({
      targetKey: input.targetKey,
      familyId: "datadog",
      variantId: "datadog-default",
      enabled: true,
      config: {},
    })
    .onConflictDoUpdate({
      target: input.env.controlPlaneTables.integrationTargets.targetKey,
      set: {
        familyId: "datadog",
        variantId: "datadog-default",
        enabled: true,
        config: {},
      },
    });

  const response = await input.env.controlPlaneApi.http.fetch(
    `/v1/integration/connections/${input.targetKey}/form`,
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        cookie: input.cookie,
      },
      body: JSON.stringify({
        displayName: "Direct egress Datadog connection",
        methodId: "api-key",
        config: {
          connection_method: "api-key",
        },
        secrets: {
          apiKey: "datadog-api-key",
          applicationKey: "datadog-application-key",
        },
      }),
    },
  );

  if (response.status !== 201) {
    throw new Error(
      `Expected Datadog connection creation status 201, got ${String(response.status)}.`,
    );
  }

  return readConnectionId(await response.json());
}

function readConnectionId(responseBody: unknown): string {
  if (
    typeof responseBody === "object" &&
    responseBody !== null &&
    "id" in responseBody &&
    typeof responseBody.id === "string"
  ) {
    return responseBody.id;
  }

  throw new Error("Expected integration connection response body to include id.");
}

async function mintDirectEgressToken(input: {
  organizationId: string;
  sandboxInstanceId: string;
}): Promise<string> {
  const minted = await mintEgressToken({
    config: {
      tokenSecret: EgressTokenSecret,
      tokenIssuer: EgressTokenIssuer,
      tokenAudience: EgressTokenAudience,
    },
    claims: {
      sub: input.sandboxInstanceId,
      organizationId: input.organizationId,
      bootstrapSessionId: "bst_direct_egress_integration",
    },
    ttlSeconds: 120,
  });

  return minted.token;
}

async function startSimulatedHttpUpstream(): Promise<SimulatedHttpUpstream> {
  const receivedRequests: ReceivedHttpRequest[] = [];
  const waitingResolvers: Array<(request: ReceivedHttpRequest) => void> = [];
  const server = createServer((request, response) => {
    handleSimulatedHttpRequest({
      receivedRequests,
      request,
      response,
      waitingResolvers,
    });
  });
  const port = await listen(server);

  return {
    baseUrl: `http://127.0.0.1:${String(port)}`,
    close: async () => {
      await closeServer(server);
    },
    nextRequest: async () => {
      const request = receivedRequests.shift();
      if (request !== undefined) {
        return request;
      }

      return await new Promise<ReceivedHttpRequest>((resolve) => {
        waitingResolvers.push(resolve);
      });
    },
  };
}

function handleSimulatedHttpRequest(input: {
  receivedRequests: ReceivedHttpRequest[];
  request: IncomingMessage;
  response: ServerResponse;
  waitingResolvers: Array<(request: ReceivedHttpRequest) => void>;
}): void {
  const chunks: Buffer[] = [];
  input.request.on("data", (chunk: Buffer) => {
    chunks.push(chunk);
  });
  input.request.on("end", () => {
    const receivedRequest = {
      body: Buffer.concat(chunks).toString("utf8"),
      headers: input.request.headers,
      method: input.request.method ?? "",
      url: input.request.url ?? "",
    };
    const resolver = input.waitingResolvers.shift();
    if (resolver !== undefined) {
      resolver(receivedRequest);
    } else {
      input.receivedRequests.push(receivedRequest);
    }

    input.response.statusCode = 202;
    input.response.setHeader("content-type", "text/plain; charset=utf-8");
    input.response.setHeader("x-upstream-marker", "simulated-http");
    input.response.end("hello from upstream");
  });
}

async function startSimulatedWebSocketUpstream(): Promise<SimulatedWebSocketUpstream> {
  const server = createServer();
  const webSocketServer = new WebSocketServer({ server });
  const waitingConnectionResolvers: Array<() => void> = [];
  let pendingConnections = 0;

  webSocketServer.on("connection", (socket) => {
    const resolver = waitingConnectionResolvers.shift();
    if (resolver !== undefined) {
      resolver();
    } else {
      pendingConnections += 1;
    }

    socket.on("message", (data, isBinary) => {
      if (isBinary) {
        socket.send(Buffer.concat([Buffer.from("echo:", "utf8"), toBuffer(data)]), {
          binary: true,
        });
        return;
      }

      socket.send(`echo:${toBuffer(data).toString("utf8")}`);
    });
  });
  const port = await listen(server);

  return {
    baseUrl: `ws://127.0.0.1:${String(port)}`,
    close: async () => {
      await closeWebSocketServer(webSocketServer);
      await closeServer(server);
    },
    nextConnection: async () => {
      if (pendingConnections > 0) {
        pendingConnections -= 1;
        return;
      }

      await new Promise<void>((resolve) => {
        waitingConnectionResolvers.push(resolve);
      });
    },
  };
}

function toBuffer(data: WebSocket.RawData): Buffer {
  if (Buffer.isBuffer(data)) {
    return data;
  }
  if (data instanceof ArrayBuffer) {
    return Buffer.from(data);
  }

  return Buffer.concat(data);
}

async function withTimeout<T>(input: {
  label: string;
  promise: Promise<T>;
  timeoutMs?: number;
}): Promise<T> {
  let timeoutHandle: TimerHandle | undefined;

  try {
    return await Promise.race([
      input.promise,
      new Promise<T>((_, reject) => {
        timeoutHandle = systemScheduler.schedule(() => {
          reject(
            new Error(
              `${input.label} timed out after ${String(input.timeoutMs ?? StepTimeoutMs)}ms.`,
            ),
          );
        }, input.timeoutMs ?? StepTimeoutMs);
      }),
    ]);
  } finally {
    if (timeoutHandle !== undefined) {
      systemScheduler.cancel(timeoutHandle);
    }
  }
}

function listen(server: Server): Promise<number> {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject);
      const address = server.address();
      if (address === null || typeof address === "string") {
        reject(new Error("Expected simulated upstream to listen on a TCP port."));
        return;
      }

      resolve(address.port);
    });
  });
}

function closeServer(server: Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close((error?: Error) => {
      if (error !== undefined) {
        reject(error);
        return;
      }

      resolve();
    });
  });
}

async function closeWebSocketServer(webSocketServer: WebSocketServer): Promise<void> {
  await Promise.all(
    [...webSocketServer.clients].map(
      (socket) =>
        new Promise<void>((resolve) => {
          socket.once("close", () => {
            resolve();
          });
          socket.close();
        }),
    ),
  );

  await new Promise<void>((resolve, reject) => {
    webSocketServer.close((error?: Error) => {
      if (error !== undefined) {
        reject(error);
        return;
      }

      resolve();
    });
  });
}

async function closeIfOpen(socket: WebSocket): Promise<void> {
  if (socket.readyState !== WebSocket.OPEN) {
    return;
  }

  await closeWebSocket(socket);
}
