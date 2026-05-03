/* eslint-disable jest/no-standalone-expect --
 * The integration harness returns a Vitest fixture-bound `it` function.
 */

import { randomUUID } from "node:crypto";

import {
  createDataPlaneSandboxInstancesClient,
  type DataPlaneSandboxInstancesClient,
} from "@mistle/data-plane-internal-client";
import { SandboxInstanceStatuses } from "@mistle/db/data-plane";
import { mintBootstrapToken } from "@mistle/gateway-tunnel-auth";
import {
  createSandboxAdapter,
  SandboxProvider,
  type SandboxAdapter,
  type SandboxHandle,
} from "@mistle/sandbox";
import {
  createIntegrationTest,
  TestEnvironmentIdHeader,
  type IntegrationTestEnvironment,
} from "@mistle/test-harness/integration";
import { systemClock, systemSleeper } from "@mistle/time";
import { typeid } from "typeid-js";
import { expect } from "vitest";
import WebSocket from "ws";

import {
  closeWebSocket,
  connectSandboxTunnelWebSocket,
  sendWebSocketMessage,
} from "../../data-plane-gateway/integration/websocket-test-helpers.js";

const InternalServiceToken = "integration-new-internal-service-token";
const BootstrapTokenSecret = "integration-new-bootstrap-token-secret";
const BootstrapTokenIssuer = "integration-new-data-plane-worker";
const GatewayTokenAudience = "integration-new-data-plane-gateway";
const RuntimeStatusTimeoutMs = 30_000;
const RuntimeStatusPollIntervalMs = 100;

const it = createIntegrationTest({
  services: ["data-plane-api", "data-plane-gateway"],
});

it("reports a provider-running sandbox as connectable once the gateway runtime is ready", async ({
  env,
}) => {
  const adapter = createSandboxAdapter({
    provider: SandboxProvider.DOCKER,
    docker: {
      socketPath: "/var/run/docker.sock",
    },
  });
  const organizationId = `org_${typeid("org").toString()}`;
  const sandboxInstanceId = typeid("sbi").toString();
  const sandbox = await adapter.start({
    image: {
      provider: SandboxProvider.DOCKER,
      imageId: "registry:3",
      createdAt: "2026-03-27T00:00:00.000Z",
    },
  });
  let bootstrapSocket: WebSocket | undefined;

  try {
    await env.dataPlaneDb.insert(env.dataPlaneTables.sandboxInstances).values({
      id: sandboxInstanceId,
      organizationId,
      sandboxProfileId: "sbp_integration_new_runtime_status",
      sandboxProfileVersion: 1,
      runtimeProvider: "docker",
      providerSandboxId: sandbox.id,
      status: SandboxInstanceStatuses.RUNNING,
      startedByKind: "user",
      startedById: "usr_integration_new_runtime_status",
      source: "dashboard",
    });

    bootstrapSocket = await connectBootstrapSocket({ env, sandboxInstanceId });
    await sendWebSocketMessage(
      bootstrapSocket,
      JSON.stringify({
        type: "runtime.ready",
        ready: true,
      }),
    );

    await expect(
      waitForSandboxStatus({
        client: clientFor(env),
        organizationId,
        sandboxInstanceId,
        status: "running",
      }),
    ).resolves.toMatchObject({
      id: sandboxInstanceId,
      status: "running",
      connectable: true,
    });
  } finally {
    await closeIfOpen(bootstrapSocket);
    await destroySandbox(adapter, sandbox);
  }
}, 60_000);

function clientFor(env: IntegrationTestEnvironment): DataPlaneSandboxInstancesClient {
  return createDataPlaneSandboxInstancesClient({
    baseUrl: env.dataPlaneApi.hostBaseUrl,
    serviceToken: InternalServiceToken,
    testEnvironmentId: env.id,
    testEnvironmentIdHeader: TestEnvironmentIdHeader,
  });
}

async function connectBootstrapSocket(input: {
  env: IntegrationTestEnvironment;
  sandboxInstanceId: string;
}): Promise<WebSocket> {
  return await connectSandboxTunnelWebSocket({
    websocketBaseUrl: createWebSocketBaseUrl(input.env.dataPlaneGateway.hostBaseUrl),
    sandboxInstanceId: input.sandboxInstanceId,
    tokenKind: "bootstrap",
    token: await mintBootstrapToken({
      config: {
        bootstrapTokenSecret: BootstrapTokenSecret,
        tokenIssuer: BootstrapTokenIssuer,
        tokenAudience: GatewayTokenAudience,
      },
      jti: randomUUID(),
      sandboxInstanceId: input.sandboxInstanceId,
      ttlSeconds: 120,
    }),
    headers: {
      [TestEnvironmentIdHeader]: input.env.id,
    },
  });
}

async function waitForSandboxStatus(input: {
  client: DataPlaneSandboxInstancesClient;
  organizationId: string;
  sandboxInstanceId: string;
  status: string;
}) {
  const deadlineMs = systemClock.nowMs() + RuntimeStatusTimeoutMs;

  while (systemClock.nowMs() < deadlineMs) {
    const sandboxInstance = await input.client.getSandboxInstance({
      organizationId: input.organizationId,
      instanceId: input.sandboxInstanceId,
    });

    if (sandboxInstance?.status === input.status) {
      return sandboxInstance;
    }

    await systemSleeper.sleep(RuntimeStatusPollIntervalMs);
  }

  throw new Error(
    `Timed out waiting for sandbox '${input.sandboxInstanceId}' status to reach '${input.status}'.`,
  );
}

async function closeIfOpen(socket: WebSocket | undefined): Promise<void> {
  if (socket === undefined || socket.readyState !== WebSocket.OPEN) {
    return;
  }

  await closeWebSocket(socket);
}

async function destroySandbox(adapter: SandboxAdapter, sandbox: SandboxHandle): Promise<void> {
  await adapter
    .destroy({
      id: sandbox.id,
    })
    .catch(() => undefined);
}

function createWebSocketBaseUrl(httpBaseUrl: string): string {
  const url = new URL(httpBaseUrl);
  url.protocol = "ws:";
  return url.toString().replace(/\/$/u, "");
}
