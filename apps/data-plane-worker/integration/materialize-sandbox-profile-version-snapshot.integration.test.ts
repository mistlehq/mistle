/* eslint-disable jest/no-standalone-expect --
 * The test cases use an extended Vitest fixture created by the test harness.
 */

import { ControlPlaneInternalClient } from "@mistle/control-plane-internal-client";
import {
  SandboxProfileVersionSnapshotJobStates,
  SandboxProfileVersionSnapshotJobTriggers,
  SandboxProfileVersionStates,
} from "@mistle/db/control-plane";
import {
  SandboxInstancePurposes,
  SandboxInstanceSources,
  SandboxInstanceStatuses,
} from "@mistle/db/data-plane";
import { SandboxProvider } from "@mistle/sandbox";
import { SandboxLifecycleEvents } from "@mistle/sandbox-lifecycle";
import {
  createIntegrationTest,
  TestEnvironmentIdHeader,
  type IntegrationTestEnvironment,
} from "@mistle/test-harness/integration";
import { systemClock } from "@mistle/time";
import { describe, expect } from "vitest";

import { logger as dataPlaneWorkerLogger } from "../logger.js";
import {
  createDataPlaneWorkerRuntimeConfig,
  type DataPlaneWorkerConfig,
} from "../openworkflow/core/config.js";
import { createSandboxRuntimeProviderResolver } from "../openworkflow/core/sandbox-runtime-resolver.js";
import {
  executeMaterializeSandboxProfileVersionSnapshot,
  type SnapshotWorkflowStepRunner,
} from "../openworkflow/materialize-sandbox-profile-version-snapshot/workflow.js";
import { applySandboxLifecycleEvent } from "../openworkflow/shared/apply-sandbox-lifecycle-event.js";
import { markSandboxInstanceStarting } from "../openworkflow/shared/mark-sandbox-instance-starting.js";
import { markSandboxInstanceRunning } from "../openworkflow/start-sandbox-instance/mark-sandbox-instance-running.js";
import { persistSandboxInstanceProvisioning } from "../openworkflow/start-sandbox-instance/persist-sandbox-instance-provisioning.js";

const InternalServiceToken = "integration-new-internal-service-token";
const DockerSocketPath = "/var/run/docker.sock";

const it = createIntegrationTest({
  services: ["control-plane-api", "data-plane-worker"],
});

describe.concurrent("data-plane worker snapshot materialization", () => {
  it("returns without creating sandbox state when another workflow run owns the snapshot job", async ({
    env,
  }) => {
    const organizationId = "org_snapshot_claim_loss_integration_new";
    const sandboxProfileId = "sbp_snapshot_claim_loss_integration_new";
    const snapshotJobId = "ssj_snapshot_claim_loss_integration_new";
    const sandboxInstanceId = "sbi_snapshot_claim_loss_integration_new";
    const workflowRunId = "wr_snapshot_claim_loss_integration_new";
    const existingWorkflowRunId = "wr_snapshot_claim_loss_existing_integration_new";

    await env.controlPlaneDb.insert(env.controlPlaneTables.organizations).values({
      id: organizationId,
      name: "Snapshot Claim Loss Org",
      slug: "snapshot-claim-loss-integration-new",
    });
    await env.controlPlaneDb.insert(env.controlPlaneTables.sandboxProfiles).values({
      id: sandboxProfileId,
      organizationId,
      displayName: "Snapshot Claim Loss Profile",
    });
    await env.controlPlaneDb.insert(env.controlPlaneTables.sandboxProfileVersions).values({
      sandboxProfileId,
      version: 1,
      state: SandboxProfileVersionStates.PUBLISHED,
      publishedAt: new Date().toISOString(),
      setupScript: "printf 'claim-loss' > /tmp/mistle-snapshot-marker.txt",
    });
    await env.controlPlaneDb
      .insert(env.controlPlaneTables.sandboxProfileVersionSnapshotJobs)
      .values({
        id: snapshotJobId,
        sandboxProfileId,
        sandboxProfileVersion: 1,
        trigger: SandboxProfileVersionSnapshotJobTriggers.PUBLISH,
        state: SandboxProfileVersionSnapshotJobStates.RUNNING,
        workflowRunId: existingWorkflowRunId,
        startedAt: new Date().toISOString(),
      });

    const runtimeConfig = createDataPlaneWorkerRuntimeConfig({
      app: createWorkerConfig(env),
    });
    const controlPlaneInternalClient = createControlPlaneInternalClient(env);

    const output = await executeMaterializeSandboxProfileVersionSnapshot({
      ctx: {
        config: runtimeConfig,
        controlPlaneInternalClient,
        clock: systemClock,
        db: env.dataPlaneDb,
        tables: env.dataPlaneTables,
        logger: dataPlaneWorkerLogger,
        processEnv: {},
        sandboxdArtifactResolver: undefined,
        sandboxRuntimeProviderResolver: createSandboxRuntimeProviderResolver({
          config: runtimeConfig,
          controlPlaneInternalClient,
        }),
      },
      workflowInput: {
        snapshotJobId,
        sandboxInstanceId,
        organizationId,
        sandboxProfileId,
        sandboxProfileVersion: 1,
        snapshotPreparationScriptKind: "setup",
        image: {
          imageId: "integration-new-snapshot-claim-loss-image",
          createdAt: new Date().toISOString(),
          kind: "base",
          provider: SandboxProvider.DOCKER,
        },
        sandboxRuntime: {
          provider: SandboxProvider.DOCKER,
        },
      },
      workflowRunId,
      step: createInlineStepApi(),
    });

    expect(output).toEqual({
      snapshotJobId,
      sandboxInstanceId,
      claimed: false,
    });

    const persistedJob = await env.controlPlaneDb.query.sandboxProfileVersionSnapshotJobs.findFirst(
      {
        where: (table, { eq }) => eq(table.id, snapshotJobId),
      },
    );
    expect(persistedJob).toMatchObject({
      id: snapshotJobId,
      state: SandboxProfileVersionSnapshotJobStates.RUNNING,
      workflowRunId: existingWorkflowRunId,
    });

    await expect(
      env.dataPlaneDb.query.sandboxInstances.findFirst({
        where: (table, { eq }) => eq(table.id, sandboxInstanceId),
      }),
    ).resolves.toBeUndefined();
  });

  it("marks a claimed snapshot job failed when sandbox credential resolution fails", async ({
    env,
  }) => {
    const organizationId = "org_snapshot_resolve_failure_integration";
    const sandboxProfileId = "sbp_snapshot_resolve_failure_integration";
    const snapshotJobId = "ssj_snapshot_resolve_failure_integration";
    const sandboxInstanceId = "sbi_snapshot_resolve_failure_integration";
    const workflowRunId = "wr_snapshot_resolve_failure_integration";

    await env.controlPlaneDb.insert(env.controlPlaneTables.organizations).values({
      id: organizationId,
      name: "Snapshot Resolve Failure Org",
      slug: "snapshot-resolve-failure-integration",
    });
    await env.controlPlaneDb.insert(env.controlPlaneTables.sandboxProfiles).values({
      id: sandboxProfileId,
      organizationId,
      displayName: "Snapshot Resolve Failure Profile",
    });
    await env.controlPlaneDb.insert(env.controlPlaneTables.sandboxProfileVersions).values({
      sandboxProfileId,
      version: 1,
      state: SandboxProfileVersionStates.PUBLISHED,
      setupScript: "printf 'resolve-failure' > /tmp/mistle-snapshot-marker.txt",
      sandboxProvider: SandboxProvider.E2B,
      sandboxConnectionId: null,
      sandboxVcpuCount: 2,
      sandboxMemoryMb: 4096,
      sandboxStorageMb: null,
    });
    await env.controlPlaneDb
      .insert(env.controlPlaneTables.sandboxProfileVersionSnapshotJobs)
      .values({
        id: snapshotJobId,
        sandboxProfileId,
        sandboxProfileVersion: 1,
        trigger: SandboxProfileVersionSnapshotJobTriggers.PUBLISH,
        state: SandboxProfileVersionSnapshotJobStates.QUEUED,
      });

    const runtimeConfig = createDataPlaneWorkerRuntimeConfig({
      app: createWorkerConfig(env),
    });
    const controlPlaneInternalClient = createControlPlaneInternalClient(env);

    await expect(
      executeMaterializeSandboxProfileVersionSnapshot({
        ctx: {
          config: runtimeConfig,
          controlPlaneInternalClient,
          clock: systemClock,
          db: env.dataPlaneDb,
          tables: env.dataPlaneTables,
          logger: dataPlaneWorkerLogger,
          processEnv: {},
          sandboxdArtifactResolver: undefined,
          sandboxRuntimeProviderResolver: createSandboxRuntimeProviderResolver({
            config: runtimeConfig,
            controlPlaneInternalClient,
          }),
        },
        workflowInput: {
          snapshotJobId,
          sandboxInstanceId,
          organizationId,
          sandboxProfileId,
          sandboxProfileVersion: 1,
          snapshotPreparationScriptKind: "setup",
          image: {
            imageId: "integration-snapshot-resolve-failure-image",
            createdAt: "2026-01-01T00:00:00.000Z",
            kind: "base",
            provider: SandboxProvider.E2B,
          },
          sandboxRuntime: {
            provider: SandboxProvider.E2B,
            resources: {
              vcpuCount: 2,
              memoryMb: 4096,
            },
          },
        },
        workflowRunId,
        step: createInlineStepApi(),
      }),
    ).rejects.toThrow("Failed to resolve snapshot sandbox runtime credentials.");

    const persistedJob = await env.controlPlaneDb.query.sandboxProfileVersionSnapshotJobs.findFirst(
      {
        where: (table, { eq }) => eq(table.id, snapshotJobId),
      },
    );
    expect(persistedJob).toMatchObject({
      id: snapshotJobId,
      state: SandboxProfileVersionSnapshotJobStates.FAILED,
      workflowRunId,
      errorCode: "snapshot_sandbox_runtime_resolve_failed",
    });
    expect(persistedJob?.errorMessage).toContain(
      "Failed to resolve snapshot sandbox runtime credentials.",
    );

    await expect(
      env.dataPlaneDb.query.sandboxInstances.findFirst({
        where: (table, { eq }) => eq(table.id, sandboxInstanceId),
      }),
    ).resolves.toBeUndefined();
  });

  it("applies the snapshot sandbox provisioning lifecycle sequence", async ({ env }) => {
    const sandboxInstanceId = "sbi_snapshot_lifecycle_sequence_integration";
    const sandboxProfileId = "sbp_snapshot_lifecycle_sequence_integration";

    await env.dataPlaneDb.insert(env.dataPlaneTables.sandboxInstances).values({
      id: sandboxInstanceId,
      organizationId: "org_snapshot_lifecycle_sequence_integration",
      sandboxProfileId,
      sandboxProfileVersion: 1,
      runtimeProvider: SandboxProvider.DOCKER,
      status: SandboxInstanceStatuses.PENDING,
      startedByKind: "system",
      startedById: "ssj_snapshot_lifecycle_sequence_integration",
      source: SandboxInstanceSources.SYSTEM,
      purpose: SandboxInstancePurposes.SNAPSHOT,
    });

    await markSandboxInstanceStarting({
      db: env.dataPlaneDb,
      tables: env.dataPlaneTables,
      sandboxInstanceId,
    });
    await persistSandboxInstanceProvisioning(
      {
        db: env.dataPlaneDb,
        tables: env.dataPlaneTables,
      },
      {
        sandboxInstanceId,
        runtimePlan: {
          sandboxProfileId,
          version: 1,
          image: {
            source: "base",
            imageRef: "registry:snapshot-lifecycle",
          },
          egressRoutes: [],
          artifacts: [],
          runtimeClients: [],
          workspaceSources: [],
          agentRuntimes: [],
        },
        sandboxProfileId,
        sandboxProfileVersion: 1,
        providerSandboxId: "provider-snapshot-lifecycle-sequence-integration",
      },
    );
    await applySandboxLifecycleEvent(
      {
        db: env.dataPlaneDb,
        tables: env.dataPlaneTables,
      },
      {
        sandboxInstanceId,
        event: SandboxLifecycleEvents.PROVIDER_RUNTIME_INITIALIZATION_STARTED,
      },
    );
    await markSandboxInstanceRunning(
      {
        db: env.dataPlaneDb,
        tables: env.dataPlaneTables,
      },
      {
        sandboxInstanceId,
      },
    );

    const sandboxInstance = await env.dataPlaneDb.query.sandboxInstances.findFirst({
      columns: {
        status: true,
        providerSandboxId: true,
        startedAt: true,
      },
      where: (table, { eq }) => eq(table.id, sandboxInstanceId),
    });
    expect(sandboxInstance).toMatchObject({
      status: SandboxInstanceStatuses.RUNNING,
      providerSandboxId: "provider-snapshot-lifecycle-sequence-integration",
    });
    expect(sandboxInstance?.startedAt).not.toBeNull();

    await expect(
      env.dataPlaneDb.query.sandboxInstanceRuntimePlans.findFirst({
        columns: {
          revision: true,
          compiledFromProfileId: true,
          compiledFromProfileVersion: true,
        },
        where: (table, { eq }) => eq(table.sandboxInstanceId, sandboxInstanceId),
      }),
    ).resolves.toEqual({
      revision: 1,
      compiledFromProfileId: sandboxProfileId,
      compiledFromProfileVersion: 1,
    });
  });
});

function createControlPlaneInternalClient(
  env: IntegrationTestEnvironment,
): ControlPlaneInternalClient {
  return new ControlPlaneInternalClient({
    baseUrl: env.controlPlaneApi.hostBaseUrl,
    internalAuthServiceToken: InternalServiceToken,
    testEnvironmentId: env.id,
    testEnvironmentIdHeader: TestEnvironmentIdHeader,
  });
}

function createWorkerConfig(env: IntegrationTestEnvironment): DataPlaneWorkerConfig {
  return {
    database: {
      url: "postgresql://unused",
    },
    workflow: {
      databaseUrl: "postgresql://unused",
      namespaceId: "integration-new-worker-snapshot",
      runMigrations: false,
      concurrency: 1,
      databasePoolMax: 2,
    },
    runtimeState: {
      gatewayBaseUrl: "http://127.0.0.1:5202",
    },
    controlPlaneApi: {
      baseUrl: env.controlPlaneApi.hostBaseUrl,
    },
    sandbox: {
      internalGatewayWsUrl: "ws://127.0.0.1:5003/tunnel/sandbox",
      bootstrap: {
        tokenSecret: "integration-new-bootstrap-token-secret",
        tokenIssuer: "integration-new-data-plane-worker",
        tokenAudience: "integration-new-data-plane-gateway",
      },
      docker: {
        enabled: true,
        socketPath: DockerSocketPath,
      },
    },
    internalAuth: {
      serviceToken: InternalServiceToken,
    },
    telemetry: {
      enabled: false,
      debug: false,
    },
  };
}

function createInlineStepApi(): SnapshotWorkflowStepRunner {
  return {
    run: async (_config, fn) => await fn(),
  };
}
