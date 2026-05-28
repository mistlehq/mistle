/* eslint-disable jest/no-standalone-expect --
 * The integration harness returns a Vitest fixture-bound `it` function.
 */

import { randomUUID } from "node:crypto";

import {
  createDataPlaneSandboxInstancesClient,
  type StartSandboxInstanceInput,
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

it("reports a persisted running sandbox as reconnecting until the gateway runtime is ready", async ({
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
  const image = await adapter.prepareImage({
    image: {
      provider: SandboxProvider.DOCKER,
      imageId: "registry:3",
      createdAt: "2026-03-27T00:00:00.000Z",
    },
  });
  const sandbox = await adapter.start({
    image,
  });
  let bootstrapSocket: WebSocket | undefined;
  const runtimePlan = createRuntimePlan({
    sandboxProfileId: "sbp_integration_new_runtime_status",
    version: 1,
    cwd: "/root/mistlehq/mistle",
  });

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
    await env.dataPlaneDb.insert(env.dataPlaneTables.sandboxInstanceRuntimePlans).values({
      sandboxInstanceId,
      revision: 1,
      compiledRuntimePlan: runtimePlan,
      compiledFromProfileId: "sbp_integration_new_runtime_status",
      compiledFromProfileVersion: 1,
    });

    await expect(
      clientFor(env).getSandboxInstance({
        organizationId,
        instanceId: sandboxInstanceId,
      }),
    ).resolves.toMatchObject({
      id: sandboxInstanceId,
      status: "reconnecting",
      connectable: false,
      runtimePlan,
    });

    bootstrapSocket = await connectBootstrapSocket({ env, sandboxInstanceId });
    await sendWebSocketMessage(
      bootstrapSocket,
      JSON.stringify({
        type: "runtime.ready",
        ready: true,
      }),
    );

    const runningSandbox = await waitForSandboxStatus({
      client: clientFor(env),
      organizationId,
      sandboxInstanceId,
      status: "running",
    });
    expect(runningSandbox).toMatchObject({
      id: sandboxInstanceId,
      status: "running",
      connectable: true,
      runtimePlan,
    });

    await adapter.destroy({
      id: sandbox.id,
    });
    await expect(
      waitForSandboxStatus({
        client: clientFor(env),
        organizationId,
        sandboxInstanceId,
        status: "failed",
      }),
    ).resolves.toMatchObject({
      id: sandboxInstanceId,
      status: "failed",
      connectable: false,
      failureCode: "provider_runtime_missing",
      failureMessage: "Sandbox runtime was not found at the provider during inspection.",
    });
  } finally {
    await closeIfOpen(bootstrapSocket);
    await destroySandbox(adapter, sandbox);
  }
}, 60_000);

it("applies runtime lifecycle events for reconnecting bootstrap sessions", async ({ env }) => {
  const organizationId = `org_${typeid("org").toString()}`;
  const sandboxInstanceId = typeid("sbi").toString();
  const client = clientFor(env);

  await env.dataPlaneDb.insert(env.dataPlaneTables.sandboxInstances).values({
    id: sandboxInstanceId,
    organizationId,
    sandboxProfileId: "sbp_integration_runtime_lifecycle",
    sandboxProfileVersion: 1,
    runtimeProvider: "docker",
    providerSandboxId: "provider-runtime-lifecycle",
    status: SandboxInstanceStatuses.RUNNING,
    startedByKind: "user",
    startedById: "usr_integration_runtime_lifecycle",
    source: "dashboard",
  });

  await expect(
    client.applySandboxRuntimeLifecycleEvent({
      sandboxInstanceId,
      kind: "bootstrap_detached",
      ownerLeaseId: "lease_runtime_lifecycle",
    }),
  ).resolves.toMatchObject({
    status: "ok",
    sandboxInstanceId,
    lifecycleStatus: SandboxInstanceStatuses.RECONNECTING,
  });

  await expect(
    client.applySandboxRuntimeLifecycleEvent({
      sandboxInstanceId,
      kind: "runtime_readiness_reported",
      ownerLeaseId: "lease_runtime_lifecycle",
      runtimeReady: false,
    }),
  ).resolves.toMatchObject({
    lifecycleStatus: SandboxInstanceStatuses.INITIALIZING,
  });

  await expect(
    client.applySandboxRuntimeLifecycleEvent({
      sandboxInstanceId,
      kind: "runtime_readiness_reported",
      ownerLeaseId: "lease_runtime_lifecycle",
      runtimeReady: true,
    }),
  ).resolves.toMatchObject({
    lifecycleStatus: SandboxInstanceStatuses.RUNNING,
  });
});

it("ignores readiness reports that do not match the persisted lifecycle state", async ({ env }) => {
  const sandboxInstanceId = typeid("sbi").toString();

  await env.dataPlaneDb.insert(env.dataPlaneTables.sandboxInstances).values({
    id: sandboxInstanceId,
    organizationId: `org_${typeid("org").toString()}`,
    sandboxProfileId: "sbp_integration_runtime_lifecycle_ignored",
    sandboxProfileVersion: 1,
    runtimeProvider: "docker",
    providerSandboxId: "provider-runtime-lifecycle-ignored",
    status: SandboxInstanceStatuses.STARTED,
    startedByKind: "user",
    startedById: "usr_integration_runtime_lifecycle_ignored",
    source: "dashboard",
  });

  await expect(
    clientFor(env).applySandboxRuntimeLifecycleEvent({
      sandboxInstanceId,
      kind: "runtime_readiness_reported",
      ownerLeaseId: "lease_runtime_lifecycle_ignored",
      runtimeReady: true,
    }),
  ).resolves.toMatchObject({
    lifecycleStatus: SandboxInstanceStatuses.STARTED,
  });
});

it("rejects runtime readiness lifecycle requests without a readiness value", async ({ env }) => {
  const sandboxInstanceId = typeid("sbi").toString();

  const response = await env.dataPlaneApi.http.fetch(
    `/internal/sandbox/instances/${sandboxInstanceId}/runtime-lifecycle-events`,
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-mistle-service-token": InternalServiceToken,
        [TestEnvironmentIdHeader]: env.id,
      },
      body: JSON.stringify({
        kind: "runtime_readiness_reported",
        ownerLeaseId: "lease_runtime_lifecycle_missing_ready",
      }),
    },
  );

  expect(response.status).toBe(400);
});

function createRuntimePlan(input: {
  sandboxProfileId: string;
  version: number;
  cwd: string;
}): StartSandboxInstanceInput["runtimePlan"] {
  return {
    sandboxProfileId: input.sandboxProfileId,
    version: input.version,
    image: {
      source: "base",
      imageRef: "registry:3",
    },
    egressRoutes: [],
    artifacts: [],
    runtimeClients: [],
    workspaceSources: [
      {
        sourceKind: "git-clone",
        resourceKind: "repository",
        path: input.cwd,
        originUrl: "https://github.com/mistlehq/mistle.git",
      },
    ],
    agentRuntimes: [
      {
        runtimeId: "codex",
        runtimeKey: "codex-app-server",
        clientId: "codex-cli",
        endpointKey: "app-server",
        ptyLaunch: {
          runtimeId: "codex",
          displayName: "Codex",
          newLaunch: {
            ptySessionId: "cli",
            cols: 120,
            rows: 32,
            cwd: input.cwd,
            command: "codex",
            args: [],
          },
          resumeLaunch: {
            ptySessionId: "cli",
            cols: 120,
            rows: 32,
            cwd: input.cwd,
            command: "codex",
            args: [],
          },
        },
      },
    ],
  };
}

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
