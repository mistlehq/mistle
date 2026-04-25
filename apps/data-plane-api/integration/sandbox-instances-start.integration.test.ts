import {
  createDataPlaneSandboxInstancesClient,
  type StartSandboxInstanceInput,
} from "@mistle/data-plane-internal-client";
import {
  organizationSandboxStorageSettings,
  organizations,
  SandboxStorageConfigSources,
} from "@mistle/db/control-plane";
import { SandboxInstancePersistenceModes, SandboxInstanceStatuses } from "@mistle/db/data-plane";
import { reserveAvailablePort } from "@mistle/test-harness";
import { systemSleeper } from "@mistle/time";
import type { Pool } from "pg";
import { describe, expect } from "vitest";
import { z } from "zod";

import { createDataPlaneApiRuntime } from "../src/main.js";
import { it } from "./test-context.js";

type WorkflowRunRow = {
  id: string;
  namespace_id: string;
  workflow_name: string;
  status: string;
  input: unknown;
  output: null;
};

const WorkflowRunInputSchema = z
  .object({
    sandboxInstanceId: z.string().min(1),
    organizationId: z.string().min(1),
    sandboxProfileId: z.string().min(1),
    persistenceMode: z.enum([
      SandboxInstancePersistenceModes.EPHEMERAL,
      SandboxInstancePersistenceModes.PERSISTENT,
    ]),
    image: z
      .object({
        imageId: z.string().min(1),
        createdAt: z.string().min(1).optional(),
        kind: z.enum(["base", "snapshot"]),
        provider: z.enum(["docker", "e2b"]).optional(),
      })
      .strict()
      .optional(),
  })
  .loose();

const WorkflowName = "data-plane.sandbox-instances.start";
const WorkflowQueuePollIntervalMs = 100;
const WorkflowQueueWaitTimeoutMs = 10_000;

function createRuntimePlan(input: {
  sandboxProfileId: string;
  version: number;
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
    workspaceSources: [],
    agentRuntimes: [],
  };
}

function createSandboxInstancesClient(
  baseUrl: string,
  serviceToken: string,
): ReturnType<typeof createDataPlaneSandboxInstancesClient> {
  return createDataPlaneSandboxInstancesClient({
    baseUrl,
    serviceToken,
  });
}

async function waitForWorkflowRuns(input: {
  runQuery: (organizationId: string, sandboxProfileId: string) => Promise<WorkflowRunRow[]>;
  organizationId: string;
  sandboxProfileId: string;
}): Promise<WorkflowRunRow[]> {
  const deadline = Date.now() + WorkflowQueueWaitTimeoutMs;

  while (Date.now() < deadline) {
    const workflowRuns = await input.runQuery(input.organizationId, input.sandboxProfileId);
    if (workflowRuns.length > 0) {
      return workflowRuns;
    }

    await systemSleeper.sleep(WorkflowQueuePollIntervalMs);
  }

  throw new Error(
    `Timed out waiting for queued workflow run for organization '${input.organizationId}' and profile '${input.sandboxProfileId}'.`,
  );
}

async function countWorkflowRuns(input: {
  dbPool: Pool;
  workflowNamespaceId: string;
  organizationId: string;
  sandboxProfileId: string;
}): Promise<number> {
  const result = await input.dbPool.query(
    `
      select count(*)::text as count
      from data_plane_openworkflow.workflow_runs
      where
        namespace_id = $1
        and workflow_name = $2
        and input->>'organizationId' = $3
        and input->>'sandboxProfileId' = $4
    `,
    [input.workflowNamespaceId, WorkflowName, input.organizationId, input.sandboxProfileId],
  );

  const row = result.rows[0];
  if (row === undefined) {
    throw new Error("Expected workflow run count row to exist.");
  }

  return Number(row.count);
}

describe("sandboxInstances.start integration", () => {
  it("returns an accepted start response and queues a workflow run", async ({ fixture }) => {
    const client = createSandboxInstancesClient(fixture.baseUrl, fixture.internalAuthServiceToken);
    const sandboxProfileId = "sbp_dp_api_integration_001";
    const workflowInput: StartSandboxInstanceInput = {
      organizationId: "org_dp_api_integration_001",
      sandboxProfileId,
      sandboxProfileVersion: 7,
      runtimePlan: createRuntimePlan({
        sandboxProfileId,
        version: 7,
      }),
      startedBy: {
        kind: "user",
        id: "usr_dp_api_integration_001",
      },
      source: "dashboard",
      image: {
        imageId: "im_dp_api_integration_001",
        createdAt: "2026-02-27T00:00:00.000Z",
        kind: "base",
      },
    };

    const startedSandbox = await client.startSandboxInstance(workflowInput);

    expect(startedSandbox.status).toBe("accepted");
    expect(startedSandbox.sandboxInstanceId).toMatch(/^sbi_[a-zA-Z0-9_-]+$/);
    expect(startedSandbox.workflowRunId).not.toBe("");

    const workflowRuns = await waitForWorkflowRuns({
      runQuery: async (organizationId, profileId) => {
        const result = await fixture.dbPool.query<WorkflowRunRow>(
          `
            select id, namespace_id, workflow_name, status, input, output
            from data_plane_openworkflow.workflow_runs
            where
              namespace_id = $1
              and workflow_name = $2
              and input->>'organizationId' = $3
              and input->>'sandboxProfileId' = $4
            order by created_at asc
          `,
          [fixture.config.workflow.namespaceId, WorkflowName, organizationId, profileId],
        );
        return result.rows;
      },
      organizationId: workflowInput.organizationId,
      sandboxProfileId: workflowInput.sandboxProfileId,
    });

    expect(workflowRuns).toHaveLength(1);
    const queuedRun = workflowRuns[0];
    if (queuedRun === undefined) {
      throw new Error("Expected queued workflow run row to exist.");
    }
    expect(queuedRun.id).toBe(startedSandbox.workflowRunId);
    expect(queuedRun.namespace_id).toBe(fixture.config.workflow.namespaceId);
    expect(queuedRun.workflow_name).toBe(WorkflowName);
    expect(queuedRun.status).toBe("pending");
    expect(queuedRun.output).toBeNull();

    const parsedWorkflowInput = WorkflowRunInputSchema.parse(queuedRun.input);
    expect(parsedWorkflowInput.organizationId).toBe(workflowInput.organizationId);
    expect(parsedWorkflowInput.sandboxProfileId).toBe(workflowInput.sandboxProfileId);
    expect(parsedWorkflowInput.sandboxInstanceId).toBe(startedSandbox.sandboxInstanceId);
    expect(parsedWorkflowInput.persistenceMode).toBe(SandboxInstancePersistenceModes.EPHEMERAL);
  }, 60_000);

  it("queues snapshot launches with the stored snapshot provider", async ({ fixture }) => {
    const client = createSandboxInstancesClient(fixture.baseUrl, fixture.internalAuthServiceToken);
    const sandboxProfileId = "sbp_dp_api_snapshot_launch";
    const workflowInput: StartSandboxInstanceInput = {
      organizationId: "org_dp_api_snapshot_launch",
      sandboxProfileId,
      sandboxProfileVersion: 9,
      runtimePlan: {
        ...createRuntimePlan({
          sandboxProfileId,
          version: 9,
        }),
        image: {
          source: "snapshot",
          imageRef: "snap_dp_api_snapshot_launch",
        },
      },
      startedBy: {
        kind: "user",
        id: "usr_dp_api_snapshot_launch",
      },
      source: "dashboard",
      image: {
        imageId: "snap_dp_api_snapshot_launch",
        createdAt: "2026-02-27T00:00:00.000Z",
        kind: "snapshot",
        provider: "docker",
      },
    };

    const startedSandbox = await client.startSandboxInstance(workflowInput);

    const workflowRuns = await waitForWorkflowRuns({
      runQuery: async (organizationId, profileId) => {
        const result = await fixture.dbPool.query<WorkflowRunRow>(
          `
            select id, namespace_id, workflow_name, status, input, output
            from data_plane_openworkflow.workflow_runs
            where
              namespace_id = $1
              and workflow_name = $2
              and input->>'organizationId' = $3
              and input->>'sandboxProfileId' = $4
            order by created_at asc
          `,
          [fixture.config.workflow.namespaceId, WorkflowName, organizationId, profileId],
        );
        return result.rows;
      },
      organizationId: workflowInput.organizationId,
      sandboxProfileId: workflowInput.sandboxProfileId,
    });

    const queuedRun = workflowRuns[0];
    if (queuedRun === undefined) {
      throw new Error("Expected queued workflow run row to exist.");
    }

    const parsedWorkflowInput = WorkflowRunInputSchema.parse(queuedRun.input);
    expect(parsedWorkflowInput.sandboxInstanceId).toBe(startedSandbox.sandboxInstanceId);
    expect(parsedWorkflowInput.image).toEqual({
      imageId: "snap_dp_api_snapshot_launch",
      createdAt: "2026-02-27T00:00:00.000Z",
      kind: "snapshot",
      provider: "docker",
    });
  }, 60_000);

  it("deduplicates duplicate start requests by idempotency key", async ({ fixture }) => {
    const client = createSandboxInstancesClient(fixture.baseUrl, fixture.internalAuthServiceToken);
    const sandboxProfileId = "sbp_dp_api_integration_idempotent";
    const workflowInput: StartSandboxInstanceInput = {
      organizationId: "org_dp_api_integration_idempotent",
      sandboxProfileId,
      sandboxProfileVersion: 11,
      idempotencyKey: "dashboard-start-001",
      runtimePlan: createRuntimePlan({
        sandboxProfileId,
        version: 11,
      }),
      startedBy: {
        kind: "user",
        id: "usr_dp_api_integration_idempotent",
      },
      source: "dashboard",
      image: {
        imageId: "im_dp_api_integration_idempotent",
        createdAt: "2026-02-27T00:00:00.000Z",
        kind: "base",
      },
    };

    const firstStartedSandbox = await client.startSandboxInstance(workflowInput);
    const secondStartedSandbox = await client.startSandboxInstance(workflowInput);

    expect(secondStartedSandbox).toEqual(firstStartedSandbox);

    const queuedWorkflowRuns = await waitForWorkflowRuns({
      runQuery: async (organizationId, profileId) => {
        const result = await fixture.dbPool.query<WorkflowRunRow>(
          `
            select id, namespace_id, workflow_name, status, input, output
            from data_plane_openworkflow.workflow_runs
            where
              namespace_id = $1
              and workflow_name = $2
              and input->>'organizationId' = $3
              and input->>'sandboxProfileId' = $4
            order by created_at asc
          `,
          [fixture.config.workflow.namespaceId, WorkflowName, organizationId, profileId],
        );
        return result.rows;
      },
      organizationId: workflowInput.organizationId,
      sandboxProfileId: workflowInput.sandboxProfileId,
    });

    expect(queuedWorkflowRuns).toHaveLength(1);
    expect(queuedWorkflowRuns[0]?.id).toBe(firstStartedSandbox.workflowRunId);
  }, 60_000);

  it("creates a pending sandbox instance row immediately after start is accepted", async ({
    fixture,
  }) => {
    const client = createSandboxInstancesClient(fixture.baseUrl, fixture.internalAuthServiceToken);
    const sandboxProfileId = "sbp_dp_api_sync_insert";
    const workflowInput: StartSandboxInstanceInput = {
      organizationId: "org_dp_api_sync_insert",
      sandboxProfileId,
      sandboxProfileVersion: 1,
      runtimePlan: createRuntimePlan({
        sandboxProfileId,
        version: 1,
      }),
      startedBy: {
        kind: "user",
        id: "usr_dp_api_sync_insert",
      },
      source: "dashboard",
      image: {
        imageId: "im_dp_api_sync_insert",
        createdAt: "2026-02-27T00:00:00.000Z",
        kind: "base",
      },
    };

    const startedSandbox = await client.startSandboxInstance(workflowInput);

    const persistedSandboxInstance = await fixture.db.query.sandboxInstances.findFirst({
      columns: {
        id: true,
        organizationId: true,
        sandboxProfileId: true,
        sandboxProfileVersion: true,
        providerSandboxId: true,
        persistenceMode: true,
        status: true,
      },
      where: (table, { eq }) => eq(table.id, startedSandbox.sandboxInstanceId),
    });

    expect(persistedSandboxInstance).toEqual({
      id: startedSandbox.sandboxInstanceId,
      organizationId: workflowInput.organizationId,
      sandboxProfileId: workflowInput.sandboxProfileId,
      sandboxProfileVersion: workflowInput.sandboxProfileVersion,
      providerSandboxId: null,
      persistenceMode: SandboxInstancePersistenceModes.EPHEMERAL,
      status: SandboxInstanceStatuses.PENDING,
    });

    const persistedRuntimePlans = await fixture.db.query.sandboxInstanceRuntimePlans.findMany({
      columns: {
        id: true,
      },
      where: (table, { eq }) => eq(table.sandboxInstanceId, startedSandbox.sandboxInstanceId),
    });
    expect(persistedRuntimePlans).toHaveLength(0);
  }, 60_000);

  it("persists persistent mode when the organization enables persistent sandboxes", async ({
    fixture,
  }) => {
    await fixture.controlPlaneDb.insert(organizations).values({
      id: "org_dp_api_persistent_mode",
      name: "Persistent mode org",
      slug: "org-dp-api-persistent-mode",
    });
    await fixture.controlPlaneDb.insert(organizationSandboxStorageSettings).values({
      organizationId: "org_dp_api_persistent_mode",
      persistentSandboxesEnabled: true,
      storageConfigSource: SandboxStorageConfigSources.MANAGED,
    });

    const client = createSandboxInstancesClient(fixture.baseUrl, fixture.internalAuthServiceToken);
    const sandboxProfileId = "sbp_dp_api_persistent_mode";
    const workflowInput: StartSandboxInstanceInput = {
      organizationId: "org_dp_api_persistent_mode",
      sandboxProfileId,
      sandboxProfileVersion: 3,
      runtimePlan: createRuntimePlan({
        sandboxProfileId,
        version: 3,
      }),
      startedBy: {
        kind: "user",
        id: "usr_dp_api_persistent_mode",
      },
      source: "dashboard",
      image: {
        imageId: "im_dp_api_persistent_mode",
        createdAt: "2026-02-27T00:00:00.000Z",
        kind: "base",
      },
    };

    const startedSandbox = await client.startSandboxInstance(workflowInput);

    const persistedSandboxInstance = await fixture.db.query.sandboxInstances.findFirst({
      columns: {
        id: true,
        persistenceMode: true,
        status: true,
      },
      where: (table, { eq }) => eq(table.id, startedSandbox.sandboxInstanceId),
    });

    expect(persistedSandboxInstance).toEqual({
      id: startedSandbox.sandboxInstanceId,
      persistenceMode: SandboxInstancePersistenceModes.PERSISTENT,
      status: SandboxInstanceStatuses.PENDING,
    });

    const workflowRuns = await waitForWorkflowRuns({
      runQuery: async (organizationId, profileId) => {
        const result = await fixture.dbPool.query<WorkflowRunRow>(
          `
            select id, namespace_id, workflow_name, status, input, output
            from data_plane_openworkflow.workflow_runs
            where
              namespace_id = $1
              and workflow_name = $2
              and input->>'organizationId' = $3
              and input->>'sandboxProfileId' = $4
            order by created_at asc
          `,
          [fixture.config.workflow.namespaceId, WorkflowName, organizationId, profileId],
        );
        return result.rows;
      },
      organizationId: workflowInput.organizationId,
      sandboxProfileId: workflowInput.sandboxProfileId,
    });

    const queuedRun = workflowRuns[0];
    if (queuedRun === undefined) {
      throw new Error("Expected queued workflow run row to exist.");
    }

    const parsedWorkflowInput = WorkflowRunInputSchema.parse(queuedRun.input);
    expect(parsedWorkflowInput.persistenceMode).toBe(SandboxInstancePersistenceModes.PERSISTENT);
  }, 60_000);

  it("persists persistent mode for e2b runtimes when archil storage is configured", async ({
    fixture,
  }) => {
    const organizationId = "org_dp_api_e2b_archil_persistent_mode";
    const sandboxProfileId = "sbp_dp_api_e2b_archil_persistent_mode";

    await fixture.controlPlaneDb.insert(organizations).values({
      id: organizationId,
      name: "E2B persistent mode org",
      slug: "org-dp-api-e2b-archil-persistent-mode",
    });
    await fixture.controlPlaneDb.insert(organizationSandboxStorageSettings).values({
      organizationId,
      persistentSandboxesEnabled: true,
      storageConfigSource: SandboxStorageConfigSources.MANAGED,
    });

    const port = await reserveAvailablePort({ host: fixture.config.server.host });
    const runtime = await createDataPlaneApiRuntime({
      app: {
        ...fixture.config,
        server: {
          ...fixture.config.server,
          port,
        },
        sandbox: {
          ...fixture.config.sandbox,
          e2b: {
            apiKey: "integration-e2b-api-key",
            domain: "e2b.app",
          },
        },
      },
      internalAuthServiceToken: fixture.internalAuthServiceToken,
      sandboxProvider: "e2b",
      sandboxStorageBackend: "archil",
    });
    await runtime.start();

    try {
      const client = createSandboxInstancesClient(
        `http://${fixture.config.server.host}:${String(port)}`,
        fixture.internalAuthServiceToken,
      );
      const workflowInput: StartSandboxInstanceInput = {
        organizationId,
        sandboxProfileId,
        sandboxProfileVersion: 4,
        runtimePlan: createRuntimePlan({
          sandboxProfileId,
          version: 4,
        }),
        startedBy: {
          kind: "user",
          id: "usr_dp_api_e2b_archil_persistent_mode",
        },
        source: "dashboard",
        image: {
          imageId: "im_dp_api_e2b_archil_persistent_mode",
          createdAt: "2026-02-27T00:00:00.000Z",
          kind: "base",
        },
      };

      const startedSandbox = await client.startSandboxInstance(workflowInput);

      const persistedSandboxInstance = await fixture.db.query.sandboxInstances.findFirst({
        columns: {
          id: true,
          persistenceMode: true,
          runtimeProvider: true,
          status: true,
        },
        where: (table, { eq }) => eq(table.id, startedSandbox.sandboxInstanceId),
      });

      expect(persistedSandboxInstance).toEqual({
        id: startedSandbox.sandboxInstanceId,
        persistenceMode: SandboxInstancePersistenceModes.PERSISTENT,
        runtimeProvider: "e2b",
        status: SandboxInstanceStatuses.PENDING,
      });

      const workflowRuns = await waitForWorkflowRuns({
        runQuery: async (queuedOrganizationId, queuedProfileId) => {
          const result = await fixture.dbPool.query<WorkflowRunRow>(
            `
              select id, namespace_id, workflow_name, status, input, output
              from data_plane_openworkflow.workflow_runs
              where
                namespace_id = $1
                and workflow_name = $2
                and input->>'organizationId' = $3
                and input->>'sandboxProfileId' = $4
              order by created_at asc
            `,
            [
              fixture.config.workflow.namespaceId,
              WorkflowName,
              queuedOrganizationId,
              queuedProfileId,
            ],
          );
          return result.rows;
        },
        organizationId: workflowInput.organizationId,
        sandboxProfileId: workflowInput.sandboxProfileId,
      });

      const queuedRun = workflowRuns[0];
      if (queuedRun === undefined) {
        throw new Error("Expected queued workflow run row to exist.");
      }

      const parsedWorkflowInput = WorkflowRunInputSchema.parse(queuedRun.input);
      expect(parsedWorkflowInput.persistenceMode).toBe(SandboxInstancePersistenceModes.PERSISTENT);
    } finally {
      await runtime.stop();
    }
  }, 60_000);

  it("fails before enqueue and insert when persistent sandboxes are enabled without a durable backend", async ({
    fixture,
  }) => {
    const organizationId = "org_dp_api_persistent_without_backend";
    const sandboxProfileId = "sbp_dp_api_persistent_without_backend";

    await fixture.controlPlaneDb.insert(organizations).values({
      id: organizationId,
      name: "Persistent without backend org",
      slug: "org-dp-api-persistent-without-backend",
    });
    await fixture.controlPlaneDb.insert(organizationSandboxStorageSettings).values({
      organizationId,
      persistentSandboxesEnabled: true,
      storageConfigSource: SandboxStorageConfigSources.MANAGED,
    });

    const port = await reserveAvailablePort({ host: fixture.config.server.host });
    const runtime = await createDataPlaneApiRuntime({
      app: {
        ...fixture.config,
        server: {
          ...fixture.config.server,
          port,
        },
      },
      internalAuthServiceToken: fixture.internalAuthServiceToken,
      sandboxProvider: "docker",
      sandboxStorageBackend: undefined,
    });
    await runtime.start();

    try {
      const client = createSandboxInstancesClient(
        `http://${fixture.config.server.host}:${String(port)}`,
        fixture.internalAuthServiceToken,
      );
      const workflowInput: StartSandboxInstanceInput = {
        organizationId,
        sandboxProfileId,
        sandboxProfileVersion: 5,
        runtimePlan: createRuntimePlan({
          sandboxProfileId,
          version: 5,
        }),
        startedBy: {
          kind: "user",
          id: "usr_dp_api_persistent_without_backend",
        },
        source: "dashboard",
        image: {
          imageId: "im_dp_api_persistent_without_backend",
          createdAt: "2026-02-27T00:00:00.000Z",
          kind: "base",
        },
      };

      await expect(client.startSandboxInstance(workflowInput)).rejects.toThrow(
        `Persistent sandboxes are enabled for organization '${organizationId}' but no supported durable storage backend is configured for this deployment.`,
      );

      expect(
        await countWorkflowRuns({
          dbPool: fixture.dbPool,
          workflowNamespaceId: fixture.config.workflow.namespaceId,
          organizationId,
          sandboxProfileId,
        }),
      ).toBe(0);

      const persistedSandboxInstance = await fixture.db.query.sandboxInstances.findFirst({
        columns: {
          id: true,
        },
        where: (table, { and, eq }) =>
          and(
            eq(table.organizationId, organizationId),
            eq(table.sandboxProfileId, sandboxProfileId),
          ),
      });

      expect(persistedSandboxInstance).toBeUndefined();
    } finally {
      await runtime.stop();
    }
  }, 60_000);
});
