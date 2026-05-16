/* eslint-disable jest/no-standalone-expect --
 * The integration harness returns a Vitest fixture-bound `it` function.
 */

import { randomUUID } from "node:crypto";

import {
  SandboxInstancePersistenceModes,
  SandboxInstancePurposes,
  SandboxInstanceSources,
  SandboxInstanceStatuses,
  SandboxStopReasons,
} from "@mistle/db/data-plane";
import { mintBootstrapToken } from "@mistle/gateway-tunnel-auth";
import {
  SandboxRuntimeStateSnapshotSchema,
  type SandboxRuntimeStateSnapshot,
} from "@mistle/sandbox-runtime-contract";
import {
  createIntegrationTest,
  TestEnvironmentIdHeader,
  type IntegrationTestEnvironment,
} from "@mistle/test-harness/integration";
import { systemSleeper } from "@mistle/time";
import { StopSandboxInstanceWorkflowSpec } from "@mistle/workflow-registry/data-plane";
import { typeid } from "typeid-js";
import { describe, expect } from "vitest";

import {
  closeWebSocket,
  connectSandboxTunnelWebSocket,
  waitForWebSocketClose,
} from "../../data-plane-gateway/integration/websocket-test-helpers.js";

const TestTimeoutMs = 30_000;
const WebSocketOpenReadyState = 1;
const RuntimeStateReadTimeoutMs = 5_000;
const RuntimeStateReadPollIntervalMs = 50;
const InternalServiceTokenHeader = "x-mistle-service-token";
const InternalServiceToken = "integration-new-internal-service-token";
const BootstrapTokenSecret = "integration-new-bootstrap-token-secret";
const BootstrapTokenIssuer = "integration-new-data-plane-worker";
const GatewayTokenAudience = "integration-new-data-plane-gateway";

const it = createIntegrationTest({
  services: ["data-plane-api", "data-plane-gateway", "data-plane-worker"],
});

type ConnectedWebSocket = Awaited<ReturnType<typeof connectSandboxTunnelWebSocket>>;

describe.concurrent("data-plane worker stop sandbox bootstrap attachment cleanup", () => {
  it(
    "terminates a stale bootstrap attachment when the stop workflow observes an already-stopped sandbox",
    async ({ env }) => {
      const sandboxInstanceId = typeid("sbi").toString();
      await insertStoppedSandboxInstance(env, sandboxInstanceId);

      const bootstrapSocket = await connectBootstrapSocket({
        env,
        sandboxInstanceId,
      });
      try {
        const attached = await waitForRuntimeState({
          env,
          sandboxInstanceId,
          predicate: (snapshot) => snapshot.ownerLeaseId !== null && snapshot.attachment !== null,
        });
        if (attached.attachment === null) {
          throw new Error("Expected bootstrap attachment before running stop workflow.");
        }

        const closeEvent = waitForWebSocketClose(bootstrapSocket);
        const handle = await env.dataPlaneWorkflow.runWorkflow(StopSandboxInstanceWorkflowSpec, {
          sandboxInstanceId,
          stopReason: SandboxStopReasons.IDLE,
          expectedOwnerLeaseId: attached.attachment.ownerLeaseId,
        });
        await expect(handle.result({ timeoutMs: 15_000 })).resolves.toEqual({
          sandboxInstanceId,
          executed: false,
          outcome: "already_stopped",
        });
        await expect(closeEvent).resolves.toEqual({
          code: 1012,
          reason: "Sandbox stopped.",
        });

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
});

async function insertStoppedSandboxInstance(
  env: IntegrationTestEnvironment,
  sandboxInstanceId: string,
): Promise<void> {
  await env.dataPlaneDb.insert(env.dataPlaneTables.sandboxInstances).values({
    id: sandboxInstanceId,
    organizationId: `org_${sandboxInstanceId}`,
    sandboxProfileId: `sbp_${sandboxInstanceId}`,
    sandboxProfileVersion: 1,
    runtimeProvider: "docker",
    providerSandboxId: `provider-${sandboxInstanceId}`,
    status: SandboxInstanceStatuses.STOPPED,
    persistenceMode: SandboxInstancePersistenceModes.EPHEMERAL,
    purpose: SandboxInstancePurposes.SESSION,
    startedByKind: "system",
    startedById: `worker_${sandboxInstanceId}`,
    source: SandboxInstanceSources.DASHBOARD,
    stoppedAt: "2026-05-16T00:00:00.000Z",
    stopReason: SandboxStopReasons.IDLE,
  });
}

async function connectBootstrapSocket(input: {
  env: IntegrationTestEnvironment;
  sandboxInstanceId: string;
}): Promise<ConnectedWebSocket> {
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
        [InternalServiceTokenHeader]: InternalServiceToken,
        [TestEnvironmentIdHeader]: input.env.id,
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

async function closeIfOpen(socket: ConnectedWebSocket): Promise<void> {
  if (socket.readyState !== WebSocketOpenReadyState) {
    return;
  }

  await closeWebSocket(socket);
}

function createWebSocketBaseUrl(httpBaseUrl: string): string {
  const url = new URL(httpBaseUrl);
  url.protocol = "ws:";
  return url.toString().replace(/\/$/u, "");
}
