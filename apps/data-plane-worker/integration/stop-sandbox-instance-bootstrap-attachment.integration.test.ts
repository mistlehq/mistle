/* eslint-disable jest/no-standalone-expect --
 * The integration harness returns a Vitest fixture-bound `it` function.
 */

import { randomUUID } from "node:crypto";

import {
  SandboxInstancePurposes,
  SandboxInstanceSources,
  SandboxInstanceStatuses,
  SandboxStopReasons,
  SandboxUsageEventTypes,
} from "@mistle/db/data-plane";
import { mintBootstrapToken } from "@mistle/gateway-tunnel-auth";
import { createSandboxAdapter, SandboxProvider } from "@mistle/sandbox";
import {
  SandboxRuntimeStateSnapshotSchema,
  type SandboxRuntimeStateSnapshot,
} from "@mistle/sandbox-runtime-contract";
import { createDockerSandboxNetworkInfra } from "@mistle/test-harness";
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
const DockerSocketPath = "/var/run/docker.sock";
const SandboxDockerNetworkInfraId = "sandbox-docker-network";
const SandboxDockerNetworkNameValue = "network.name";
const ProviderRuntimeImageRef = "nginx:1.27-alpine";
const ProviderImageCreatedAt = "2026-05-16T00:00:00.000Z";

const it = createIntegrationTest({
  services: ["data-plane-api", "data-plane-gateway", "data-plane-worker"],
  __internalInfra: createDockerSandboxNetworkInfra(),
  __afterStart: async ({ environment }) => {
    sandboxProviderRuntimeFixture = {
      baseImageRef: ProviderRuntimeImageRef,
      dockerNetworkName: readRequiredInfraValue({
        infra: environment.infra,
        infraId: SandboxDockerNetworkInfraId,
        valueKey: SandboxDockerNetworkNameValue,
      }),
    };
  },
});

type ConnectedWebSocket = Awaited<ReturnType<typeof connectSandboxTunnelWebSocket>>;
type SandboxProviderRuntimeFixture = {
  baseImageRef: string;
  dockerNetworkName: string;
};

let sandboxProviderRuntimeFixture: SandboxProviderRuntimeFixture | undefined;

describe.concurrent("data-plane worker stop sandbox bootstrap attachment cleanup", () => {
  it(
    "finalizes a running sandbox through the stop workflow",
    async ({ env }) => {
      const sandboxInstanceId = typeid("sbi").toString();
      await insertRunningSandboxInstance(env, sandboxInstanceId);

      const handle = await env.dataPlaneWorkflow.runWorkflow(StopSandboxInstanceWorkflowSpec, {
        sandboxInstanceId,
        stopReason: SandboxStopReasons.USER,
      });
      await expect(handle.result({ timeoutMs: 15_000 })).resolves.toEqual({
        sandboxInstanceId,
        executed: true,
        outcome: "stopped",
      });

      await expectSandboxStopped(env, sandboxInstanceId, SandboxStopReasons.USER);
    },
    TestTimeoutMs,
  );

  it(
    "fails a running sandbox stop when the provider runtime is missing",
    async ({ env }) => {
      const sandboxInstanceId = typeid("sbi").toString();
      await insertRunningSandboxInstance(env, sandboxInstanceId, {
        providerSandboxId: `missing-${sandboxInstanceId}`,
      });

      const handle = await env.dataPlaneWorkflow.runWorkflow(StopSandboxInstanceWorkflowSpec, {
        sandboxInstanceId,
        stopReason: SandboxStopReasons.USER,
      });
      await expect(handle.result({ timeoutMs: 15_000 })).rejects.toThrow(
        "provider_runtime_missing",
      );
      await expectSandboxFailed(env, sandboxInstanceId, {
        failureCode: "provider_runtime_missing",
        failureMessage: "Sandbox runtime was not found at the provider during stop execution.",
      });
      await expectSandboxFailedUsageEvent(env, sandboxInstanceId, {
        providerSandboxId: `missing-${sandboxInstanceId}`,
      });
    },
    TestTimeoutMs,
  );

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

async function insertRunningSandboxInstance(
  env: IntegrationTestEnvironment,
  sandboxInstanceId: string,
  input: {
    providerSandboxId?: string;
  } = {},
): Promise<void> {
  const providerSandboxId = input.providerSandboxId ?? (await startDockerProviderSandboxRuntime());

  await env.dataPlaneDb.insert(env.dataPlaneTables.sandboxInstances).values({
    id: sandboxInstanceId,
    organizationId: `org_${sandboxInstanceId}`,
    sandboxProfileId: `sbp_${sandboxInstanceId}`,
    sandboxProfileVersion: 1,
    runtimeProvider: "docker",
    providerSandboxId,
    status: SandboxInstanceStatuses.RUNNING,
    purpose: SandboxInstancePurposes.SESSION,
    startedByKind: "system",
    startedById: `worker_${sandboxInstanceId}`,
    source: SandboxInstanceSources.DASHBOARD,
  });
}

async function startDockerProviderSandboxRuntime(): Promise<string> {
  const fixture = readSandboxProviderRuntimeFixture();
  const sandboxAdapter = createSandboxAdapter({
    provider: SandboxProvider.DOCKER,
    docker: {
      socketPath: DockerSocketPath,
      networkName: fixture.dockerNetworkName,
    },
  });
  const image = await sandboxAdapter.prepareImage({
    image: {
      provider: SandboxProvider.DOCKER,
      imageId: fixture.baseImageRef,
      createdAt: ProviderImageCreatedAt,
    },
  });
  const handle = await sandboxAdapter.start({
    image,
  });

  return handle.id;
}

function readSandboxProviderRuntimeFixture(): SandboxProviderRuntimeFixture {
  if (sandboxProviderRuntimeFixture === undefined) {
    throw new Error("Sandbox provider runtime fixture was not initialized.");
  }

  return sandboxProviderRuntimeFixture;
}

function readRequiredInfraValue(input: {
  infra: {
    get(id: string): { values: ReadonlyMap<string, string> } | undefined;
  };
  infraId: string;
  valueKey: string;
}): string {
  const infra = input.infra.get(input.infraId);
  if (infra === undefined) {
    throw new Error(`Expected integration infra '${input.infraId}' to be available.`);
  }

  const value = infra.values.get(input.valueKey);
  if (value === undefined) {
    throw new Error(`Expected integration infra '${input.infraId}' to expose '${input.valueKey}'.`);
  }

  return value;
}

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
    purpose: SandboxInstancePurposes.SESSION,
    startedByKind: "system",
    startedById: `worker_${sandboxInstanceId}`,
    source: SandboxInstanceSources.DASHBOARD,
    stoppedAt: "2026-05-16T00:00:00.000Z",
    stopReason: SandboxStopReasons.IDLE,
  });
}

async function expectSandboxStopped(
  env: IntegrationTestEnvironment,
  sandboxInstanceId: string,
  stopReason: string,
): Promise<void> {
  const persistedInstance = await env.dataPlaneDb.query.sandboxInstances.findFirst({
    columns: {
      status: true,
      stopReason: true,
      stoppedAt: true,
    },
    where: (table, { eq }) => eq(table.id, sandboxInstanceId),
  });

  expect(persistedInstance).toEqual({
    status: SandboxInstanceStatuses.STOPPED,
    stopReason,
    stoppedAt: expect.any(String),
  });
}

async function expectSandboxFailed(
  env: IntegrationTestEnvironment,
  sandboxInstanceId: string,
  input: {
    failureCode: string;
    failureMessage: string;
  },
): Promise<void> {
  const persistedInstance = await env.dataPlaneDb.query.sandboxInstances.findFirst({
    columns: {
      status: true,
      stopReason: true,
      stoppedAt: true,
      failedAt: true,
      failureCode: true,
      failureMessage: true,
    },
    where: (table, { eq }) => eq(table.id, sandboxInstanceId),
  });

  expect(persistedInstance).toEqual({
    status: SandboxInstanceStatuses.FAILED,
    stopReason: SandboxStopReasons.FAILED,
    stoppedAt: null,
    failedAt: expect.any(String),
    failureCode: input.failureCode,
    failureMessage: input.failureMessage,
  });
}

async function expectSandboxFailedUsageEvent(
  env: IntegrationTestEnvironment,
  sandboxInstanceId: string,
  input: {
    providerSandboxId: string;
  },
): Promise<void> {
  const events = await env.dataPlaneDb.query.sandboxUsageEvents.findMany({
    columns: {
      sandboxInstanceId: true,
      eventType: true,
      runtimeProvider: true,
      providerSandboxId: true,
      computeGeneration: true,
      payload: true,
    },
    where: (table, { eq }) => eq(table.sandboxInstanceId, sandboxInstanceId),
  });

  expect(events).toEqual([
    {
      sandboxInstanceId,
      eventType: SandboxUsageEventTypes.SANDBOX_FAILED,
      runtimeProvider: "docker",
      providerSandboxId: input.providerSandboxId,
      computeGeneration: 1,
      payload: {
        workflowRunId: expect.any(String),
        operationKind: "stop",
        stopReason: SandboxStopReasons.USER,
        outcome: "failed",
      },
    },
  ]);
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
