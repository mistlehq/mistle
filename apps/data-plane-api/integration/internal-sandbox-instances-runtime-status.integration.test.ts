import { createDataPlaneSandboxInstancesClient } from "@mistle/data-plane-internal-client";
import { sandboxInstances, SandboxInstanceStatuses } from "@mistle/db/data-plane";
import { systemClock, systemSleeper } from "@mistle/time";
import { typeid } from "typeid-js";
import { describe, expect } from "vitest";

import {
  closeWebSocket,
  connectBootstrapSocket,
  mintValidBootstrapToken,
  startGatewayProcess,
} from "./runtime-status-test-helpers.js";
import { it, type DataPlaneApiIntegrationFixture } from "./test-context.js";

const RuntimeStatusTestTimeoutMs = 60_000;
const StatusPollTimeoutMs = 10_000;
const StatusPollIntervalMs = 50;

async function waitForSandboxStatus(input: {
  fixture: DataPlaneApiIntegrationFixture;
  organizationId: string;
  sandboxInstanceId: string;
  expectedStatus: string;
}): Promise<void> {
  const client = createDataPlaneSandboxInstancesClient({
    baseUrl: input.fixture.baseUrl,
    serviceToken: input.fixture.internalAuthServiceToken,
  });
  const deadlineMs = systemClock.nowMs() + StatusPollTimeoutMs;

  while (systemClock.nowMs() < deadlineMs) {
    const sandboxInstance = await client.getSandboxInstance({
      organizationId: input.organizationId,
      instanceId: input.sandboxInstanceId,
    });

    if (sandboxInstance?.status === input.expectedStatus) {
      return;
    }

    await systemSleeper.sleep(StatusPollIntervalMs);
  }

  throw new Error(
    `Timed out waiting for sandbox '${input.sandboxInstanceId}' to reach status '${input.expectedStatus}'.`,
  );
}

async function startGatewayForFixture(input: { fixture: DataPlaneApiIntegrationFixture }) {
  const gatewayPort = Number(new URL(input.fixture.config.runtimeState.gatewayBaseUrl).port);
  return startGatewayProcess({
    port: gatewayPort,
    databaseUrl: input.fixture.config.database.url,
    dataPlaneApiBaseUrl: input.fixture.baseUrl,
    internalAuthServiceToken: input.fixture.internalAuthServiceToken,
  });
}

describe("internal sandbox instance runtime status integration", () => {
  it(
    "returns starting until bootstrap attachment is live and returns running once attached",
    async ({ fixture }) => {
      const client = createDataPlaneSandboxInstancesClient({
        baseUrl: fixture.baseUrl,
        serviceToken: fixture.internalAuthServiceToken,
      });
      const gateway = await startGatewayForFixture({
        fixture,
      });
      const organizationId = `org_${typeid("org").toString()}`;
      const sandboxInstanceId = typeid("sbi").toString();

      try {
        await fixture.db.insert(sandboxInstances).values({
          id: sandboxInstanceId,
          organizationId,
          sandboxProfileId: "sbp_runtime_status",
          sandboxProfileVersion: 1,
          runtimeProvider: "docker",
          providerRuntimeId: "provider-runtime-status",
          status: SandboxInstanceStatuses.RUNNING,
          startedByKind: "user",
          startedById: "usr_runtime_status",
          source: "dashboard",
        });

        await expect(
          client.getSandboxInstance({
            organizationId,
            instanceId: sandboxInstanceId,
          }),
        ).resolves.toMatchObject({
          id: sandboxInstanceId,
          status: "starting",
        });

        const bootstrapSocket = await connectBootstrapSocket({
          websocketBaseUrl: gateway.websocketBaseUrl,
          sandboxInstanceId,
          token: await mintValidBootstrapToken({
            sandboxInstanceId,
          }),
        });

        await waitForSandboxStatus({
          fixture,
          organizationId,
          sandboxInstanceId,
          expectedStatus: "running",
        });

        await closeWebSocket(bootstrapSocket);

        await waitForSandboxStatus({
          fixture,
          organizationId,
          sandboxInstanceId,
          expectedStatus: "starting",
        });
      } finally {
        await gateway.stop();
      }
    },
    RuntimeStatusTestTimeoutMs,
  );

  it(
    "lists effective runtime-composed statuses for attached and unattached sandboxes",
    async ({ fixture }) => {
      const client = createDataPlaneSandboxInstancesClient({
        baseUrl: fixture.baseUrl,
        serviceToken: fixture.internalAuthServiceToken,
      });
      const gateway = await startGatewayForFixture({
        fixture,
      });
      const organizationId = `org_${typeid("org").toString()}`;
      const connectedSandboxInstanceId = typeid("sbi").toString();
      const disconnectedSandboxInstanceId = typeid("sbi").toString();
      const failedSandboxInstanceId = typeid("sbi").toString();
      const stoppedSandboxInstanceId = typeid("sbi").toString();

      try {
        await fixture.db.insert(sandboxInstances).values([
          {
            id: connectedSandboxInstanceId,
            organizationId,
            sandboxProfileId: "sbp_runtime_status",
            sandboxProfileVersion: 1,
            runtimeProvider: "docker",
            providerRuntimeId: "provider-runtime-status-connected",
            status: SandboxInstanceStatuses.STARTING,
            startedByKind: "user",
            startedById: "usr_runtime_status",
            source: "dashboard",
            createdAt: "2026-03-23T00:00:03.000Z",
            updatedAt: "2026-03-23T00:00:03.000Z",
          },
          {
            id: disconnectedSandboxInstanceId,
            organizationId,
            sandboxProfileId: "sbp_runtime_status",
            sandboxProfileVersion: 2,
            runtimeProvider: "docker",
            providerRuntimeId: "provider-runtime-status-disconnected",
            status: SandboxInstanceStatuses.RUNNING,
            startedByKind: "user",
            startedById: "usr_runtime_status",
            source: "dashboard",
            createdAt: "2026-03-23T00:00:02.000Z",
            updatedAt: "2026-03-23T00:00:02.000Z",
          },
          {
            id: failedSandboxInstanceId,
            organizationId,
            sandboxProfileId: "sbp_runtime_status",
            sandboxProfileVersion: 3,
            runtimeProvider: "docker",
            providerRuntimeId: "provider-runtime-status-failed",
            status: SandboxInstanceStatuses.FAILED,
            startedByKind: "system",
            startedById: "sys_runtime_status",
            source: "webhook",
            failureCode: "SANDBOX_START_FAILED",
            failureMessage: "Sandbox failed to start.",
            createdAt: "2026-03-23T00:00:01.000Z",
            updatedAt: "2026-03-23T00:00:01.000Z",
          },
          {
            id: stoppedSandboxInstanceId,
            organizationId,
            sandboxProfileId: "sbp_runtime_status",
            sandboxProfileVersion: 4,
            runtimeProvider: "docker",
            providerRuntimeId: "provider-runtime-status-stopped",
            status: SandboxInstanceStatuses.STOPPED,
            startedByKind: "user",
            startedById: "usr_runtime_status",
            source: "dashboard",
            createdAt: "2026-03-23T00:00:00.000Z",
            updatedAt: "2026-03-23T00:00:00.000Z",
          },
        ]);

        const bootstrapSocket = await connectBootstrapSocket({
          websocketBaseUrl: gateway.websocketBaseUrl,
          sandboxInstanceId: connectedSandboxInstanceId,
          token: await mintValidBootstrapToken({
            sandboxInstanceId: connectedSandboxInstanceId,
          }),
        });

        await waitForSandboxStatus({
          fixture,
          organizationId,
          sandboxInstanceId: connectedSandboxInstanceId,
          expectedStatus: "running",
        });

        const response = await client.listSandboxInstances({
          organizationId,
        });

        expect(response.items).toEqual([
          expect.objectContaining({
            id: connectedSandboxInstanceId,
            status: "running",
          }),
          expect.objectContaining({
            id: disconnectedSandboxInstanceId,
            status: "starting",
          }),
          expect.objectContaining({
            id: failedSandboxInstanceId,
            status: "failed",
          }),
          expect.objectContaining({
            id: stoppedSandboxInstanceId,
            status: "stopped",
          }),
        ]);

        await closeWebSocket(bootstrapSocket);
      } finally {
        await gateway.stop();
      }
    },
    RuntimeStatusTestTimeoutMs,
  );
});
