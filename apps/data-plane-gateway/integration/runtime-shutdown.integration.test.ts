/* eslint-disable jest/no-standalone-expect --
 * The integration harness returns a Vitest fixture-bound `it` function.
 */

import { randomUUID } from "node:crypto";

import { SandboxInstanceStatuses } from "@mistle/db/data-plane";
import { mintBootstrapToken } from "@mistle/gateway-tunnel-auth";
import {
  SandboxRuntimeStateSnapshotSchema,
  type SandboxRuntimeStateSnapshot,
} from "@mistle/sandbox-runtime-contract";
import {
  TestEnvironmentIdHeader,
  type IntegrationTestEnvironment,
  createIntegrationTest,
} from "@mistle/test-harness/integration";
import { systemSleeper } from "@mistle/time";
import { typeid } from "typeid-js";
import { expect } from "vitest";
import WebSocket from "ws";

import {
  closeWebSocket,
  connectSandboxTunnelWebSocket,
} from "../integration/websocket-test-helpers.js";

const TestTimeoutMs = 40_000;
const RuntimeStateReadTimeoutMs = 5_000;
const RuntimeStateReadPollIntervalMs = 50;
const InternalServiceTokenHeader = "x-mistle-service-token";
const BootstrapTokenSecret = "integration-new-bootstrap-token-secret";
const BootstrapTokenIssuer = "integration-new-data-plane-worker";
const GatewayTokenAudience = "integration-new-data-plane-gateway";

const it = createIntegrationTest({
  services: ["data-plane-api", "data-plane-gateway"],
  __dangerouslyIsolatedServices: {
    reason: "This suite intentionally stops the data-plane gateway runtime.",
    services: ["data-plane-gateway"],
  },
});

it(
  "drains bootstrap close cleanup before runtime shutdown closes runtime-state storage",
  async ({ env }) => {
    const sandboxInstanceId = typeid("sbi").toString();
    await insertSandboxInstanceRow({
      env,
      sandboxInstanceId,
    });

    let bootstrapSocket: WebSocket | undefined;

    try {
      bootstrapSocket = await connectBootstrapSocket({
        env,
        sandboxInstanceId,
      });

      const attached = await waitForRuntimeState({
        env,
        sandboxInstanceId,
        predicate: (snapshot) => snapshot.ownerLeaseId !== null && snapshot.attachment !== null,
      });
      expect(attached.attachment?.sandboxInstanceId).toBe(sandboxInstanceId);

      const gatewayBaseUrl = env.dataPlaneGateway.hostBaseUrl;
      await env.dataPlaneGateway.stop();
      bootstrapSocket = undefined;

      await env.dataPlaneGateway.start();
      expect(env.dataPlaneGateway.hostBaseUrl).toBe(gatewayBaseUrl);

      const healthResponse = await env.dataPlaneGateway.http.fetch("/__healthz");
      expect(healthResponse.ok).toBe(true);

      const cleared = await waitForRuntimeState({
        env,
        sandboxInstanceId,
        predicate: (snapshot) => snapshot.ownerLeaseId === null && snapshot.attachment === null,
      });
      expect(cleared.ownerLeaseId).toBeNull();
      expect(cleared.attachment).toBeNull();
    } finally {
      await closeIfOpen(bootstrapSocket);
    }
  },
  TestTimeoutMs,
);

async function insertSandboxInstanceRow(input: {
  env: IntegrationTestEnvironment;
  sandboxInstanceId: string;
}): Promise<void> {
  await input.env.dataPlaneDb.insert(input.env.dataPlaneTables.sandboxInstances).values({
    id: input.sandboxInstanceId,
    organizationId: "org_integration_new_gateway_shutdown",
    sandboxProfileId: "sbp_integration_new_gateway_shutdown",
    sandboxProfileVersion: 1,
    runtimeProvider: "docker",
    providerSandboxId: `provider-${input.sandboxInstanceId}`,
    status: SandboxInstanceStatuses.STARTING,
    startedByKind: "system",
    startedById: "workflow_integration_new_gateway_shutdown",
    source: "webhook",
  });
}

async function connectBootstrapSocket(input: {
  env: IntegrationTestEnvironment;
  sandboxInstanceId: string;
}): Promise<WebSocket> {
  return connectSandboxTunnelWebSocket({
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

async function readRuntimeState(input: {
  env: IntegrationTestEnvironment;
  sandboxInstanceId: string;
}): Promise<SandboxRuntimeStateSnapshot> {
  const response = await input.env.dataPlaneGateway.http.fetch(
    `/internal/sandbox-instances/${encodeURIComponent(input.sandboxInstanceId)}/runtime-state`,
    {
      headers: {
        [InternalServiceTokenHeader]: "integration-new-internal-service-token",
      },
    },
  );

  expect(response.status).toBe(200);
  return SandboxRuntimeStateSnapshotSchema.parse(await response.json());
}

async function waitForRuntimeState(input: {
  env: IntegrationTestEnvironment;
  sandboxInstanceId: string;
  predicate: (snapshot: SandboxRuntimeStateSnapshot) => boolean;
}): Promise<SandboxRuntimeStateSnapshot> {
  const deadline = Date.now() + RuntimeStateReadTimeoutMs;

  while (Date.now() < deadline) {
    const snapshot = await readRuntimeState({
      env: input.env,
      sandboxInstanceId: input.sandboxInstanceId,
    });
    if (input.predicate(snapshot)) {
      return snapshot;
    }

    await systemSleeper.sleep(RuntimeStateReadPollIntervalMs);
  }

  throw new Error(
    `Timed out waiting for runtime-state snapshot for sandbox '${input.sandboxInstanceId}'.`,
  );
}

async function closeIfOpen(socket: WebSocket | undefined): Promise<void> {
  if (socket === undefined || socket.readyState !== WebSocket.OPEN) {
    return;
  }

  await closeWebSocket(socket);
}

function createWebSocketBaseUrl(httpBaseUrl: string): string {
  const url = new URL(httpBaseUrl);
  url.protocol = "ws:";
  return url.toString().replace(/\/$/u, "");
}
