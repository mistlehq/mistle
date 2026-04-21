import { DATA_PLANE_INTERNAL_AUTH_HEADER } from "@mistle/data-plane-internal-client";
import type { StartSandboxInstanceInput } from "@mistle/data-plane-internal-client";
import {
  sandboxInstanceRuntimePlans,
  sandboxInstances,
  SandboxInstanceStatuses,
  SandboxStopReasons,
} from "@mistle/db/data-plane";
import { SandboxProvider, createSandboxAdapter } from "@mistle/sandbox";
import { systemClock, systemSleeper } from "@mistle/time";
import { describe, expect } from "vitest";

import { INTERNAL_SANDBOX_ROUTE_BASE_PATH } from "../src/internal/index.js";
import {
  closeWebSocket,
  connectBootstrapSocket,
  mintValidBootstrapToken,
  startGatewayProcess,
} from "./runtime-status-test-helpers.js";
import { it, type DataPlaneApiIntegrationFixture } from "./test-context.js";

const RuntimeAttachmentReadyTimeoutMs = 5_000;
const RuntimeAttachmentReadyPollIntervalMs = 50;

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
        bindingId: "ibd_runtime_plan",
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

type RuntimeStateSnapshot = {
  ownerLeaseId: string | null;
  attachment: {
    sandboxInstanceId: string;
    ownerLeaseId: string;
  } | null;
  runtime: {
    ready: boolean;
  };
};

function isRuntimeStateSnapshot(value: unknown): value is RuntimeStateSnapshot {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const ownerLeaseId = Object.getOwnPropertyDescriptor(value, "ownerLeaseId")?.value;
  const attachment = Object.getOwnPropertyDescriptor(value, "attachment")?.value;
  const runtime = Object.getOwnPropertyDescriptor(value, "runtime")?.value;
  if (ownerLeaseId !== null && typeof ownerLeaseId !== "string") {
    return false;
  }
  if (typeof runtime !== "object" || runtime === null) {
    return false;
  }
  const runtimeReady = Object.getOwnPropertyDescriptor(runtime, "ready")?.value;
  if (typeof runtimeReady !== "boolean") {
    return false;
  }
  if (attachment === null) {
    return true;
  }
  if (typeof attachment !== "object" || attachment === null) {
    return false;
  }

  const sandboxInstanceId = Object.getOwnPropertyDescriptor(attachment, "sandboxInstanceId")?.value;
  const attachmentOwnerLeaseId = Object.getOwnPropertyDescriptor(attachment, "ownerLeaseId")?.value;
  return typeof sandboxInstanceId === "string" && typeof attachmentOwnerLeaseId === "string";
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

async function waitForRuntimeReadiness(input: {
  fixture: DataPlaneApiIntegrationFixture;
  gatewayBaseUrl: string;
  sandboxInstanceId: string;
}): Promise<void> {
  const deadlineMs = systemClock.nowMs() + RuntimeAttachmentReadyTimeoutMs;

  while (systemClock.nowMs() < deadlineMs) {
    const response = await fetch(
      new URL(
        `/internal/sandbox-instances/${encodeURIComponent(input.sandboxInstanceId)}/runtime-state`,
        input.gatewayBaseUrl,
      ),
      {
        headers: {
          [DATA_PLANE_INTERNAL_AUTH_HEADER]: input.fixture.internalAuthServiceToken,
        },
      },
    );
    if (!response.ok) {
      throw new Error(
        `Expected runtime-state route to respond successfully for sandbox '${input.sandboxInstanceId}', got status ${String(response.status)}.`,
      );
    }

    const payload: unknown = await response.json();
    if (!isRuntimeStateSnapshot(payload)) {
      throw new Error("Runtime-state response payload is invalid.");
    }

    if (
      payload.ownerLeaseId !== null &&
      payload.attachment?.sandboxInstanceId === input.sandboxInstanceId &&
      payload.attachment.ownerLeaseId === payload.ownerLeaseId &&
      payload.runtime.ready
    ) {
      return;
    }

    await systemSleeper.sleep(RuntimeAttachmentReadyPollIntervalMs);
  }

  throw new Error(
    `Timed out waiting for runtime readiness for sandbox '${input.sandboxInstanceId}'.`,
  );
}

describe("internal sandbox instances get integration", () => {
  it("returns pending before provider provisioning begins", async ({ fixture }) => {
    await fixture.db.insert(sandboxInstances).values({
      id: "sbi_conventional_get_pending",
      organizationId: "org_dp_api_conventional_get",
      sandboxProfileId: "sbp_conventional_get",
      title: null,
      sandboxProfileVersion: 0,
      runtimeProvider: "docker",
      providerSandboxId: null,
      status: SandboxInstanceStatuses.PENDING,
      startedByKind: "user",
      startedById: "usr_conventional_get",
      source: "dashboard",
    });

    const response = await fetch(
      new URL(
        `${INTERNAL_SANDBOX_ROUTE_BASE_PATH}/instances/sbi_conventional_get_pending?organizationId=org_dp_api_conventional_get`,
        fixture.baseUrl,
      ),
      {
        headers: {
          [DATA_PLANE_INTERNAL_AUTH_HEADER]: fixture.internalAuthServiceToken,
        },
      },
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      id: "sbi_conventional_get_pending",
      title: null,
      status: "pending",
      connectable: false,
      failureCode: null,
      failureMessage: null,
      runtimePlan: null,
    });
  });

  it("returns starting for a provider-running sandbox before the gateway tunnel is attached", async ({
    fixture,
  }) => {
    const gateway = await startGatewayForFixture({
      fixture,
    });
    const adapter = createSandboxAdapter({
      provider: SandboxProvider.DOCKER,
      docker: {
        socketPath: fixture.config.sandbox.docker?.socketPath ?? "/var/run/docker.sock",
      },
    });
    const sandbox = await adapter.start({
      image: {
        provider: SandboxProvider.DOCKER,
        imageId: "registry:3",
        createdAt: "2026-03-27T00:00:00.000Z",
      },
    });

    try {
      await fixture.db.insert(sandboxInstances).values({
        id: "sbi_conventional_get_running",
        organizationId: "org_dp_api_conventional_get",
        sandboxProfileId: "sbp_conventional_get",
        title: "Investigate runtime attach",
        sandboxProfileVersion: 1,
        runtimeProvider: "docker",
        providerSandboxId: sandbox.id,
        status: SandboxInstanceStatuses.RUNNING,
        startedByKind: "user",
        startedById: "usr_conventional_get",
        source: "dashboard",
      });

      const response = await fetch(
        new URL(
          `${INTERNAL_SANDBOX_ROUTE_BASE_PATH}/instances/sbi_conventional_get_running?organizationId=org_dp_api_conventional_get`,
          fixture.baseUrl,
        ),
        {
          headers: {
            [DATA_PLANE_INTERNAL_AUTH_HEADER]: fixture.internalAuthServiceToken,
          },
        },
      );

      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toEqual({
        id: "sbi_conventional_get_running",
        title: "Investigate runtime attach",
        status: "starting",
        connectable: false,
        failureCode: null,
        failureMessage: null,
        runtimePlan: null,
      });
    } finally {
      await gateway.stop();
      await adapter.destroy({ id: sandbox.id });
    }
  }, 60_000);

  it("marks starting sandboxes failed when provider inspection reports the runtime missing", async ({
    fixture,
  }) => {
    const adapter = createSandboxAdapter({
      provider: SandboxProvider.DOCKER,
      docker: {
        socketPath: fixture.config.sandbox.docker?.socketPath ?? "/var/run/docker.sock",
      },
    });
    const sandbox = await adapter.start({
      image: {
        provider: SandboxProvider.DOCKER,
        imageId: "registry:3",
        createdAt: "2026-03-27T00:00:00.000Z",
      },
    });

    await fixture.db.insert(sandboxInstances).values({
      id: "sbi_conventional_get_starting_missing",
      organizationId: "org_dp_api_conventional_get",
      sandboxProfileId: "sbp_conventional_get",
      title: null,
      sandboxProfileVersion: 4,
      runtimeProvider: "docker",
      providerSandboxId: sandbox.id,
      status: SandboxInstanceStatuses.STARTING,
      startedByKind: "user",
      startedById: "usr_conventional_get",
      source: "dashboard",
    });

    await adapter.destroy({ id: sandbox.id });

    const response = await fetch(
      new URL(
        `${INTERNAL_SANDBOX_ROUTE_BASE_PATH}/instances/sbi_conventional_get_starting_missing?organizationId=org_dp_api_conventional_get`,
        fixture.baseUrl,
      ),
      {
        headers: {
          [DATA_PLANE_INTERNAL_AUTH_HEADER]: fixture.internalAuthServiceToken,
        },
      },
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      id: "sbi_conventional_get_starting_missing",
      title: null,
      status: "failed",
      connectable: false,
      failureCode: "provider_runtime_missing",
      failureMessage: "Sandbox runtime was not found at the provider during startup inspection.",
      runtimePlan: null,
    });

    const persistedRow = await fixture.db.query.sandboxInstances.findFirst({
      columns: {
        status: true,
        stopReason: true,
        failureCode: true,
        failureMessage: true,
      },
      where: (table, { eq }) => eq(table.id, "sbi_conventional_get_starting_missing"),
    });
    expect(persistedRow).toEqual({
      status: SandboxInstanceStatuses.FAILED,
      stopReason: SandboxStopReasons.FAILED,
      failureCode: "provider_runtime_missing",
      failureMessage: "Sandbox runtime was not found at the provider during startup inspection.",
    });
  }, 60_000);

  it("keeps persistent starting sandboxes recoverably stopped when provider inspection reports the runtime missing", async ({
    fixture,
  }) => {
    const adapter = createSandboxAdapter({
      provider: SandboxProvider.DOCKER,
      docker: {
        socketPath: fixture.config.sandbox.docker?.socketPath ?? "/var/run/docker.sock",
      },
    });
    const sandbox = await adapter.start({
      image: {
        provider: SandboxProvider.DOCKER,
        imageId: "registry:3",
        createdAt: "2026-03-27T00:00:00.000Z",
      },
    });

    await fixture.db.insert(sandboxInstances).values({
      id: "sbi_conventional_get_starting_missing_persistent",
      organizationId: "org_dp_api_conventional_get",
      sandboxProfileId: "sbp_conventional_get",
      title: null,
      sandboxProfileVersion: 4,
      runtimeProvider: "docker",
      providerSandboxId: sandbox.id,
      status: SandboxInstanceStatuses.STARTING,
      persistenceMode: "persistent",
      startedByKind: "user",
      startedById: "usr_conventional_get",
      source: "dashboard",
    });

    await adapter.destroy({ id: sandbox.id });

    const response = await fetch(
      new URL(
        `${INTERNAL_SANDBOX_ROUTE_BASE_PATH}/instances/sbi_conventional_get_starting_missing_persistent?organizationId=org_dp_api_conventional_get`,
        fixture.baseUrl,
      ),
      {
        headers: {
          [DATA_PLANE_INTERNAL_AUTH_HEADER]: fixture.internalAuthServiceToken,
        },
      },
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      id: "sbi_conventional_get_starting_missing_persistent",
      title: null,
      status: "stopped",
      connectable: false,
      failureCode: null,
      failureMessage: null,
      runtimePlan: null,
    });

    const persistedRow = await fixture.db.query.sandboxInstances.findFirst({
      columns: {
        status: true,
        providerSandboxId: true,
        stopReason: true,
        failureCode: true,
        failureMessage: true,
      },
      where: (table, { eq }) => eq(table.id, "sbi_conventional_get_starting_missing_persistent"),
    });
    expect(persistedRow).toEqual({
      status: SandboxInstanceStatuses.STOPPED,
      providerSandboxId: null,
      stopReason: SandboxStopReasons.SYSTEM,
      failureCode: null,
      failureMessage: null,
    });
  }, 60_000);

  it("surfaces starting from inspection for starting sandboxes without mutating the row while the gateway tunnel is not ready", async ({
    fixture,
  }) => {
    const gateway = await startGatewayForFixture({
      fixture,
    });
    const adapter = createSandboxAdapter({
      provider: SandboxProvider.DOCKER,
      docker: {
        socketPath: fixture.config.sandbox.docker?.socketPath ?? "/var/run/docker.sock",
      },
    });
    const sandbox = await adapter.start({
      image: {
        provider: SandboxProvider.DOCKER,
        imageId: "registry:3",
        createdAt: "2026-03-27T00:00:00.000Z",
      },
    });

    try {
      await fixture.db.insert(sandboxInstances).values({
        id: "sbi_conventional_get_starting",
        organizationId: "org_dp_api_conventional_get",
        sandboxProfileId: "sbp_conventional_get",
        title: null,
        sandboxProfileVersion: 2,
        runtimeProvider: "docker",
        providerSandboxId: sandbox.id,
        status: SandboxInstanceStatuses.STARTING,
        startedByKind: "user",
        startedById: "usr_conventional_get",
        source: "dashboard",
      });

      const response = await fetch(
        new URL(
          `${INTERNAL_SANDBOX_ROUTE_BASE_PATH}/instances/sbi_conventional_get_starting?organizationId=org_dp_api_conventional_get`,
          fixture.baseUrl,
        ),
        {
          headers: {
            [DATA_PLANE_INTERNAL_AUTH_HEADER]: fixture.internalAuthServiceToken,
          },
        },
      );

      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toEqual({
        id: "sbi_conventional_get_starting",
        title: null,
        status: "starting",
        connectable: false,
        failureCode: null,
        failureMessage: null,
        runtimePlan: null,
      });

      const persistedRow = await fixture.db.query.sandboxInstances.findFirst({
        columns: {
          status: true,
        },
        where: (table, { eq }) => eq(table.id, "sbi_conventional_get_starting"),
      });
      expect(persistedRow?.status).toBe(SandboxInstanceStatuses.STARTING);
    } finally {
      await gateway.stop();
      await adapter.destroy({ id: sandbox.id });
    }
  }, 60_000);

  it("returns running once the provider runtime and gateway tunnel are both ready", async ({
    fixture,
  }) => {
    const adapter = createSandboxAdapter({
      provider: SandboxProvider.DOCKER,
      docker: {
        socketPath: fixture.config.sandbox.docker?.socketPath ?? "/var/run/docker.sock",
      },
    });
    const gateway = await startGatewayForFixture({
      fixture,
    });
    const sandbox = await adapter.start({
      image: {
        provider: SandboxProvider.DOCKER,
        imageId: "registry:3",
        createdAt: "2026-03-27T00:00:00.000Z",
      },
    });
    let bootstrapSocket: Awaited<ReturnType<typeof connectBootstrapSocket>> | null = null;

    try {
      await fixture.db.insert(sandboxInstances).values({
        id: "sbi_conventional_get_running_attached",
        organizationId: "org_dp_api_conventional_get",
        sandboxProfileId: "sbp_conventional_get",
        title: null,
        sandboxProfileVersion: 5,
        runtimeProvider: "docker",
        providerSandboxId: sandbox.id,
        status: SandboxInstanceStatuses.RUNNING,
        startedByKind: "user",
        startedById: "usr_conventional_get",
        source: "dashboard",
      });
      await fixture.db.insert(sandboxInstanceRuntimePlans).values({
        sandboxInstanceId: "sbi_conventional_get_running_attached",
        revision: 1,
        compiledRuntimePlan: createRuntimePlan({
          sandboxProfileId: "sbp_conventional_get",
          version: 5,
          cwd: "/root/mistlehq/mistle",
        }),
        compiledFromProfileId: "sbp_conventional_get",
        compiledFromProfileVersion: 5,
      });

      const bootstrapToken = await mintValidBootstrapToken({
        sandboxInstanceId: "sbi_conventional_get_running_attached",
      });
      bootstrapSocket = await connectBootstrapSocket({
        websocketBaseUrl: gateway.websocketBaseUrl,
        sandboxInstanceId: "sbi_conventional_get_running_attached",
        token: bootstrapToken,
      });
      bootstrapSocket.send(
        JSON.stringify({
          type: "runtime.ready",
          ready: true,
        }),
      );
      await waitForRuntimeReadiness({
        fixture,
        gatewayBaseUrl: gateway.baseUrl,
        sandboxInstanceId: "sbi_conventional_get_running_attached",
      });

      const response = await fetch(
        new URL(
          `${INTERNAL_SANDBOX_ROUTE_BASE_PATH}/instances/sbi_conventional_get_running_attached?organizationId=org_dp_api_conventional_get`,
          fixture.baseUrl,
        ),
        {
          headers: {
            [DATA_PLANE_INTERNAL_AUTH_HEADER]: fixture.internalAuthServiceToken,
          },
        },
      );

      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toEqual({
        id: "sbi_conventional_get_running_attached",
        title: null,
        status: "running",
        connectable: true,
        failureCode: null,
        failureMessage: null,
        runtimePlan: createRuntimePlan({
          sandboxProfileId: "sbp_conventional_get",
          version: 5,
          cwd: "/root/mistlehq/mistle",
        }),
      });
    } finally {
      if (bootstrapSocket !== null) {
        await closeWebSocket(bootstrapSocket);
      }
      await gateway.stop();
      await adapter.destroy({ id: sandbox.id }).catch(() => undefined);
    }
  }, 60_000);

  it("marks running sandboxes failed when provider inspection reports the runtime missing", async ({
    fixture,
  }) => {
    const adapter = createSandboxAdapter({
      provider: SandboxProvider.DOCKER,
      docker: {
        socketPath: fixture.config.sandbox.docker?.socketPath ?? "/var/run/docker.sock",
      },
    });
    const sandbox = await adapter.start({
      image: {
        provider: SandboxProvider.DOCKER,
        imageId: "registry:3",
        createdAt: "2026-03-27T00:00:00.000Z",
      },
    });

    await fixture.db.insert(sandboxInstances).values({
      id: "sbi_conventional_get_missing",
      organizationId: "org_dp_api_conventional_get",
      sandboxProfileId: "sbp_conventional_get",
      title: null,
      sandboxProfileVersion: 3,
      runtimeProvider: "docker",
      providerSandboxId: sandbox.id,
      status: SandboxInstanceStatuses.RUNNING,
      startedByKind: "user",
      startedById: "usr_conventional_get",
      source: "dashboard",
    });

    await adapter.destroy({ id: sandbox.id });

    const response = await fetch(
      new URL(
        `${INTERNAL_SANDBOX_ROUTE_BASE_PATH}/instances/sbi_conventional_get_missing?organizationId=org_dp_api_conventional_get`,
        fixture.baseUrl,
      ),
      {
        headers: {
          [DATA_PLANE_INTERNAL_AUTH_HEADER]: fixture.internalAuthServiceToken,
        },
      },
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      id: "sbi_conventional_get_missing",
      title: null,
      status: "failed",
      connectable: false,
      failureCode: "provider_runtime_missing",
      failureMessage: "Sandbox runtime was not found at the provider during inspection.",
      runtimePlan: null,
    });

    const persistedRow = await fixture.db.query.sandboxInstances.findFirst({
      columns: {
        status: true,
        stopReason: true,
        failureCode: true,
        failureMessage: true,
      },
      where: (table, { eq }) => eq(table.id, "sbi_conventional_get_missing"),
    });
    expect(persistedRow).toEqual({
      status: SandboxInstanceStatuses.FAILED,
      stopReason: SandboxStopReasons.FAILED,
      failureCode: "provider_runtime_missing",
      failureMessage: "Sandbox runtime was not found at the provider during inspection.",
    });
  }, 60_000);

  it("keeps persistent running sandboxes recoverably stopped when provider inspection reports the runtime missing", async ({
    fixture,
  }) => {
    const adapter = createSandboxAdapter({
      provider: SandboxProvider.DOCKER,
      docker: {
        socketPath: fixture.config.sandbox.docker?.socketPath ?? "/var/run/docker.sock",
      },
    });
    const sandbox = await adapter.start({
      image: {
        provider: SandboxProvider.DOCKER,
        imageId: "registry:3",
        createdAt: "2026-03-27T00:00:00.000Z",
      },
    });

    await fixture.db.insert(sandboxInstances).values({
      id: "sbi_conventional_get_missing_persistent",
      organizationId: "org_dp_api_conventional_get",
      sandboxProfileId: "sbp_conventional_get",
      title: null,
      sandboxProfileVersion: 3,
      runtimeProvider: "docker",
      providerSandboxId: sandbox.id,
      status: SandboxInstanceStatuses.RUNNING,
      persistenceMode: "persistent",
      startedByKind: "user",
      startedById: "usr_conventional_get",
      source: "dashboard",
    });

    await adapter.destroy({ id: sandbox.id });

    const response = await fetch(
      new URL(
        `${INTERNAL_SANDBOX_ROUTE_BASE_PATH}/instances/sbi_conventional_get_missing_persistent?organizationId=org_dp_api_conventional_get`,
        fixture.baseUrl,
      ),
      {
        headers: {
          [DATA_PLANE_INTERNAL_AUTH_HEADER]: fixture.internalAuthServiceToken,
        },
      },
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      id: "sbi_conventional_get_missing_persistent",
      title: null,
      status: "stopped",
      connectable: false,
      failureCode: null,
      failureMessage: null,
      runtimePlan: null,
    });

    const persistedRow = await fixture.db.query.sandboxInstances.findFirst({
      columns: {
        status: true,
        providerSandboxId: true,
        stopReason: true,
        failureCode: true,
        failureMessage: true,
      },
      where: (table, { eq }) => eq(table.id, "sbi_conventional_get_missing_persistent"),
    });
    expect(persistedRow).toEqual({
      status: SandboxInstanceStatuses.STOPPED,
      providerSandboxId: null,
      stopReason: SandboxStopReasons.SYSTEM,
      failureCode: null,
      failureMessage: null,
    });
  }, 60_000);

  it("preserves stopped sandboxes when the provider still reports them as resumable", async ({
    fixture,
  }) => {
    const adapter = createSandboxAdapter({
      provider: SandboxProvider.DOCKER,
      docker: {
        socketPath: fixture.config.sandbox.docker?.socketPath ?? "/var/run/docker.sock",
      },
    });
    const sandbox = await adapter.start({
      image: {
        provider: SandboxProvider.DOCKER,
        imageId: "registry:3",
        createdAt: "2026-03-27T00:00:00.000Z",
      },
    });

    try {
      await adapter.stop({ id: sandbox.id });
      await fixture.db.insert(sandboxInstances).values({
        id: "sbi_conventional_get_stopped_resumable",
        organizationId: "org_dp_api_conventional_get",
        sandboxProfileId: "sbp_conventional_get",
        title: null,
        sandboxProfileVersion: 6,
        runtimeProvider: "docker",
        providerSandboxId: sandbox.id,
        status: SandboxInstanceStatuses.STOPPED,
        startedByKind: "user",
        startedById: "usr_conventional_get",
        source: "dashboard",
      });

      const response = await fetch(
        new URL(
          `${INTERNAL_SANDBOX_ROUTE_BASE_PATH}/instances/sbi_conventional_get_stopped_resumable?organizationId=org_dp_api_conventional_get`,
          fixture.baseUrl,
        ),
        {
          headers: {
            [DATA_PLANE_INTERNAL_AUTH_HEADER]: fixture.internalAuthServiceToken,
          },
        },
      );

      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toEqual({
        id: "sbi_conventional_get_stopped_resumable",
        title: null,
        status: "stopped",
        connectable: false,
        failureCode: null,
        failureMessage: null,
        runtimePlan: null,
      });

      const persistedRow = await fixture.db.query.sandboxInstances.findFirst({
        columns: {
          status: true,
          stopReason: true,
          failureCode: true,
          failureMessage: true,
        },
        where: (table, { eq }) => eq(table.id, "sbi_conventional_get_stopped_resumable"),
      });
      expect(persistedRow).toEqual({
        status: SandboxInstanceStatuses.STOPPED,
        stopReason: null,
        failureCode: null,
        failureMessage: null,
      });
    } finally {
      await adapter.destroy({ id: sandbox.id }).catch(() => undefined);
    }
  }, 60_000);

  it("marks stopped sandboxes failed when provider inspection reports the runtime missing", async ({
    fixture,
  }) => {
    const adapter = createSandboxAdapter({
      provider: SandboxProvider.DOCKER,
      docker: {
        socketPath: fixture.config.sandbox.docker?.socketPath ?? "/var/run/docker.sock",
      },
    });
    const sandbox = await adapter.start({
      image: {
        provider: SandboxProvider.DOCKER,
        imageId: "registry:3",
        createdAt: "2026-03-27T00:00:00.000Z",
      },
    });

    await adapter.stop({ id: sandbox.id });
    await fixture.db.insert(sandboxInstances).values({
      id: "sbi_conventional_get_stopped_missing",
      organizationId: "org_dp_api_conventional_get",
      sandboxProfileId: "sbp_conventional_get",
      title: null,
      sandboxProfileVersion: 7,
      runtimeProvider: "docker",
      providerSandboxId: sandbox.id,
      status: SandboxInstanceStatuses.STOPPED,
      startedByKind: "user",
      startedById: "usr_conventional_get",
      source: "dashboard",
    });

    await adapter.destroy({ id: sandbox.id });

    const response = await fetch(
      new URL(
        `${INTERNAL_SANDBOX_ROUTE_BASE_PATH}/instances/sbi_conventional_get_stopped_missing?organizationId=org_dp_api_conventional_get`,
        fixture.baseUrl,
      ),
      {
        headers: {
          [DATA_PLANE_INTERNAL_AUTH_HEADER]: fixture.internalAuthServiceToken,
        },
      },
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      id: "sbi_conventional_get_stopped_missing",
      title: null,
      status: "failed",
      connectable: false,
      failureCode: "provider_runtime_missing",
      failureMessage: "Sandbox runtime was not found at the provider during inspection.",
      runtimePlan: null,
    });

    const persistedRow = await fixture.db.query.sandboxInstances.findFirst({
      columns: {
        status: true,
        stopReason: true,
        failureCode: true,
        failureMessage: true,
      },
      where: (table, { eq }) => eq(table.id, "sbi_conventional_get_stopped_missing"),
    });
    expect(persistedRow).toEqual({
      status: SandboxInstanceStatuses.FAILED,
      stopReason: SandboxStopReasons.FAILED,
      failureCode: "provider_runtime_missing",
      failureMessage: "Sandbox runtime was not found at the provider during inspection.",
    });
  }, 60_000);

  it("keeps persistent stopped sandboxes recoverably stopped when provider inspection reports the runtime missing", async ({
    fixture,
  }) => {
    const adapter = createSandboxAdapter({
      provider: SandboxProvider.DOCKER,
      docker: {
        socketPath: fixture.config.sandbox.docker?.socketPath ?? "/var/run/docker.sock",
      },
    });
    const sandbox = await adapter.start({
      image: {
        provider: SandboxProvider.DOCKER,
        imageId: "registry:3",
        createdAt: "2026-03-27T00:00:00.000Z",
      },
    });

    await adapter.stop({ id: sandbox.id });
    await fixture.db.insert(sandboxInstances).values({
      id: "sbi_conventional_get_stopped_missing_persistent",
      organizationId: "org_dp_api_conventional_get",
      sandboxProfileId: "sbp_conventional_get",
      title: null,
      sandboxProfileVersion: 7,
      runtimeProvider: "docker",
      providerSandboxId: sandbox.id,
      status: SandboxInstanceStatuses.STOPPED,
      persistenceMode: "persistent",
      startedByKind: "user",
      startedById: "usr_conventional_get",
      source: "dashboard",
    });

    await adapter.destroy({ id: sandbox.id });

    const response = await fetch(
      new URL(
        `${INTERNAL_SANDBOX_ROUTE_BASE_PATH}/instances/sbi_conventional_get_stopped_missing_persistent?organizationId=org_dp_api_conventional_get`,
        fixture.baseUrl,
      ),
      {
        headers: {
          [DATA_PLANE_INTERNAL_AUTH_HEADER]: fixture.internalAuthServiceToken,
        },
      },
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      id: "sbi_conventional_get_stopped_missing_persistent",
      title: null,
      status: "stopped",
      connectable: false,
      failureCode: null,
      failureMessage: null,
      runtimePlan: null,
    });

    const persistedRow = await fixture.db.query.sandboxInstances.findFirst({
      columns: {
        status: true,
        providerSandboxId: true,
        stopReason: true,
        failureCode: true,
        failureMessage: true,
      },
      where: (table, { eq }) => eq(table.id, "sbi_conventional_get_stopped_missing_persistent"),
    });
    expect(persistedRow).toEqual({
      status: SandboxInstanceStatuses.STOPPED,
      providerSandboxId: null,
      stopReason: null,
      failureCode: null,
      failureMessage: null,
    });
  }, 60_000);
});
