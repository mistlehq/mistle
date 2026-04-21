import { createDataPlaneSandboxInstancesClient } from "@mistle/data-plane-internal-client";
import { sandboxInstances, SandboxInstanceStatuses } from "@mistle/db/data-plane";
import { createSandboxAdapter, SandboxProvider } from "@mistle/sandbox";
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

async function waitForListedSandboxStatus(input: {
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
    const response = await client.listSandboxInstances({
      organizationId: input.organizationId,
      limit: 100,
    });
    const sandboxInstance = response.items.find((item) => item.id === input.sandboxInstanceId);

    if (sandboxInstance?.status === input.expectedStatus) {
      return;
    }

    await systemSleeper.sleep(StatusPollIntervalMs);
  }

  throw new Error(
    `Timed out waiting for sandbox '${input.sandboxInstanceId}' to reach status '${input.expectedStatus}'.`,
  );
}

async function waitForGetSandboxStatus(input: {
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
    `Timed out waiting for sandbox '${input.sandboxInstanceId}' getSandboxInstance status to reach '${input.expectedStatus}'.`,
  );
}

async function startGatewayForFixture(input: { fixture: DataPlaneApiIntegrationFixture }) {
  const gatewayPort = Number(new URL(input.fixture.config.runtimeState.gatewayBaseUrl).port);
  return startGatewayProcess({
    port: gatewayPort,
    databaseUrl: input.fixture.config.database.url,
    dataPlaneApiBaseUrl: input.fixture.baseUrl,
    controlPlaneApiBaseUrl: input.fixture.config.controlPlaneApi.baseUrl,
    internalAuthServiceToken: input.fixture.internalAuthServiceToken,
  });
}

describe("internal sandbox instance runtime status integration", () => {
  it(
    "lists idly paused running sandboxes as stopped after provider inspection reconciles them",
    async ({ fixture }) => {
      const client = createDataPlaneSandboxInstancesClient({
        baseUrl: fixture.baseUrl,
        serviceToken: fixture.internalAuthServiceToken,
      });
      const gateway = await startGatewayForFixture({
        fixture,
      });
      const adapter = createSandboxAdapter({
        provider: SandboxProvider.DOCKER,
        docker: {
          socketPath: fixture.config.sandbox.docker?.socketPath ?? "/var/run/docker.sock",
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

      try {
        await fixture.db.insert(sandboxInstances).values({
          id: sandboxInstanceId,
          organizationId,
          sandboxProfileId: "sbp_runtime_status",
          sandboxProfileVersion: 1,
          runtimeProvider: "docker",
          providerSandboxId: sandbox.id,
          status: SandboxInstanceStatuses.RUNNING,
          startedByKind: "user",
          startedById: "usr_runtime_status",
          source: "dashboard",
        });

        const bootstrapToken = await mintValidBootstrapToken({
          sandboxInstanceId,
        });
        const bootstrapSocket = await connectBootstrapSocket({
          websocketBaseUrl: gateway.websocketBaseUrl,
          sandboxInstanceId,
          token: bootstrapToken,
        });

        try {
          bootstrapSocket.send(
            JSON.stringify({
              type: "runtime.ready",
              ready: true,
            }),
          );

          await waitForListedSandboxStatus({
            fixture,
            organizationId,
            sandboxInstanceId,
            expectedStatus: "running",
          });

          await adapter.stop({
            id: sandbox.id,
          });
          await closeWebSocket(bootstrapSocket);

          await waitForListedSandboxStatus({
            fixture,
            organizationId,
            sandboxInstanceId,
            expectedStatus: "stopped",
          });

          const sandboxInstance = await client.getSandboxInstance({
            organizationId,
            instanceId: sandboxInstanceId,
          });
          expect(sandboxInstance).toMatchObject({
            id: sandboxInstanceId,
            status: "stopped",
            connectable: false,
          });

          const persistedSandboxInstance = await fixture.db.query.sandboxInstances.findFirst({
            columns: {
              status: true,
            },
            where: (table, { eq }) => eq(table.id, sandboxInstanceId),
          });
          expect(persistedSandboxInstance?.status).toBe(SandboxInstanceStatuses.STOPPED);
        } finally {
          await closeWebSocket(bootstrapSocket);
        }
      } finally {
        await gateway.stop();
        await adapter
          .destroy({
            id: sandbox.id,
          })
          .catch(() => undefined);
      }
    },
    RuntimeStatusTestTimeoutMs,
  );

  it(
    "returns starting before tunnel readiness, then running after attachment, and reconciles missing runtimes",
    async ({ fixture }) => {
      const client = createDataPlaneSandboxInstancesClient({
        baseUrl: fixture.baseUrl,
        serviceToken: fixture.internalAuthServiceToken,
      });
      const gateway = await startGatewayForFixture({
        fixture,
      });
      const adapter = createSandboxAdapter({
        provider: SandboxProvider.DOCKER,
        docker: {
          socketPath: fixture.config.sandbox.docker?.socketPath ?? "/var/run/docker.sock",
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

      try {
        await fixture.db.insert(sandboxInstances).values({
          id: sandboxInstanceId,
          organizationId,
          sandboxProfileId: "sbp_runtime_status",
          sandboxProfileVersion: 1,
          runtimeProvider: "docker",
          providerSandboxId: sandbox.id,
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
          connectable: false,
        });

        const bootstrapToken = await mintValidBootstrapToken({
          sandboxInstanceId,
        });
        const bootstrapSocket = await connectBootstrapSocket({
          websocketBaseUrl: gateway.websocketBaseUrl,
          sandboxInstanceId,
          token: bootstrapToken,
        });

        try {
          bootstrapSocket.send(
            JSON.stringify({
              type: "runtime.ready",
              ready: true,
            }),
          );
          await waitForGetSandboxStatus({
            fixture,
            organizationId,
            sandboxInstanceId,
            expectedStatus: "running",
          });

          await expect(
            client.getSandboxInstance({
              organizationId,
              instanceId: sandboxInstanceId,
            }),
          ).resolves.toMatchObject({
            id: sandboxInstanceId,
            status: "running",
            connectable: true,
          });

          await adapter.destroy({
            id: sandbox.id,
          });

          await expect(
            client.getSandboxInstance({
              organizationId,
              instanceId: sandboxInstanceId,
            }),
          ).resolves.toMatchObject({
            id: sandboxInstanceId,
            status: "failed",
            connectable: false,
            failureCode: "provider_runtime_missing",
            failureMessage: "Sandbox runtime was not found at the provider during inspection.",
          });
        } finally {
          await closeWebSocket(bootstrapSocket);
        }
      } finally {
        await gateway.stop();
        await adapter
          .destroy({
            id: sandbox.id,
          })
          .catch(() => undefined);
      }
    },
    RuntimeStatusTestTimeoutMs,
  );

  it("returns pending from getSandboxInstance before provider provisioning begins", async ({
    fixture,
  }) => {
    const client = createDataPlaneSandboxInstancesClient({
      baseUrl: fixture.baseUrl,
      serviceToken: fixture.internalAuthServiceToken,
    });
    const organizationId = `org_${typeid("org").toString()}`;
    const sandboxInstanceId = typeid("sbi").toString();

    await fixture.db.insert(sandboxInstances).values({
      id: sandboxInstanceId,
      organizationId,
      sandboxProfileId: "sbp_runtime_status",
      sandboxProfileVersion: 1,
      runtimeProvider: "docker",
      providerSandboxId: null,
      status: SandboxInstanceStatuses.PENDING,
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
      status: "pending",
      connectable: false,
      failureCode: null,
      failureMessage: null,
    });
  });

  it(
    "marks starting sandboxes failed when provider inspection reports the runtime missing",
    async ({ fixture }) => {
      const client = createDataPlaneSandboxInstancesClient({
        baseUrl: fixture.baseUrl,
        serviceToken: fixture.internalAuthServiceToken,
      });
      const adapter = createSandboxAdapter({
        provider: SandboxProvider.DOCKER,
        docker: {
          socketPath: fixture.config.sandbox.docker?.socketPath ?? "/var/run/docker.sock",
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

      await fixture.db.insert(sandboxInstances).values({
        id: sandboxInstanceId,
        organizationId,
        sandboxProfileId: "sbp_runtime_status",
        sandboxProfileVersion: 1,
        runtimeProvider: "docker",
        providerSandboxId: sandbox.id,
        status: SandboxInstanceStatuses.STARTING,
        startedByKind: "user",
        startedById: "usr_runtime_status",
        source: "dashboard",
      });

      await adapter.destroy({
        id: sandbox.id,
      });

      await expect(
        client.getSandboxInstance({
          organizationId,
          instanceId: sandboxInstanceId,
        }),
      ).resolves.toMatchObject({
        id: sandboxInstanceId,
        status: "failed",
        failureCode: "provider_runtime_missing",
        failureMessage: "Sandbox runtime was not found at the provider during startup inspection.",
      });
    },
    RuntimeStatusTestTimeoutMs,
  );

  it(
    "lists effective runtime-composed statuses and only marks keepalive active for running sandboxes",
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
            providerSandboxId: "provider-runtime-status-connected",
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
            providerSandboxId: "provider-runtime-status-disconnected",
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
            providerSandboxId: "provider-runtime-status-failed",
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
            providerSandboxId: "provider-runtime-status-stopped",
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

        bootstrapSocket.send(
          JSON.stringify({
            type: "runtime.ready",
            ready: true,
          }),
        );
        bootstrapSocket.send(
          JSON.stringify({
            type: "keepalive.state",
            active: true,
            ttlMs: 30_000,
          }),
        );
        await waitForListedSandboxStatus({
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
            keepaliveActive: true,
          }),
          expect.objectContaining({
            id: disconnectedSandboxInstanceId,
            status: "starting",
            keepaliveActive: false,
          }),
          expect.objectContaining({
            id: failedSandboxInstanceId,
            status: "failed",
            keepaliveActive: false,
          }),
          expect.objectContaining({
            id: stoppedSandboxInstanceId,
            status: "stopped",
            keepaliveActive: false,
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
