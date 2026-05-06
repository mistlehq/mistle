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
  createSandboxAdapter,
  createSandboxRuntimeControl,
  SandboxProvider,
} from "@mistle/sandbox";
import {
  createIntegrationTest,
  TestEnvironmentIdHeader,
  type IntegrationTestEnvironment,
} from "@mistle/test-harness/integration";
import { describe, expect } from "vitest";

import { logger as dataPlaneWorkerLogger } from "../logger.js";
import {
  createDataPlaneWorkerRuntimeConfig,
  type DataPlaneWorkerConfig,
} from "../openworkflow/core/config.js";
import {
  executeMaterializeSandboxProfileVersionSnapshot,
  type SnapshotWorkflowStepRunner,
} from "../openworkflow/materialize-sandbox-profile-version-snapshot/workflow.js";

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
    const sandboxRuntimeControl = createSandboxRuntimeControl({
      provider: SandboxProvider.DOCKER,
      docker: {
        socketPath: DockerSocketPath,
      },
    });

    try {
      const output = await executeMaterializeSandboxProfileVersionSnapshot({
        ctx: {
          config: runtimeConfig,
          controlPlaneInternalClient: createControlPlaneInternalClient(env),
          db: env.dataPlaneDb,
          tables: env.dataPlaneTables,
          logger: dataPlaneWorkerLogger,
          processEnv: {},
          sandboxAdapter: createSandboxAdapter({
            provider: SandboxProvider.DOCKER,
            docker: {
              socketPath: DockerSocketPath,
            },
          }),
          sandboxRuntimeControl,
        },
        workflowInput: {
          snapshotJobId,
          sandboxInstanceId,
          organizationId,
          sandboxProfileId,
          sandboxProfileVersion: 1,
          image: {
            imageId: "integration-new-snapshot-claim-loss-image",
            createdAt: new Date().toISOString(),
            kind: "base",
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

      const persistedJob =
        await env.controlPlaneDb.query.sandboxProfileVersionSnapshotJobs.findFirst({
          where: (table, { eq }) => eq(table.id, snapshotJobId),
        });
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
    } finally {
      await sandboxRuntimeControl.close();
    }
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
    },
    runtimeState: {
      gatewayBaseUrl: "http://127.0.0.1:5202",
    },
    controlPlaneApi: {
      baseUrl: env.controlPlaneApi.hostBaseUrl,
    },
    sandbox: {
      provider: "docker",
      storage: {
        backend: "docker_volume",
      },
      internalGatewayWsUrl: "ws://127.0.0.1:5003/tunnel/sandbox",
      bootstrap: {
        tokenSecret: "integration-new-bootstrap-token-secret",
        tokenIssuer: "integration-new-data-plane-worker",
        tokenAudience: "integration-new-data-plane-gateway",
      },
      egress: {
        tokenSecret: "integration-new-egress-token-secret",
        tokenIssuer: "integration-new-data-plane-worker",
        tokenAudience: "integration-new-tokenizer-proxy",
      },
      tokenizerProxyEgressBaseUrl: "http://tokenizer-proxy/tokenizer-proxy/egress",
      docker: {
        socketPath: DockerSocketPath,
      },
    },
    sandboxStorage: {
      dockerVolume: {
        namePrefix: "integration-new-worker-snapshot-",
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
