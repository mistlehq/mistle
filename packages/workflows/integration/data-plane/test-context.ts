import type { Worker } from "openworkflow";
import type { BackendPostgres } from "openworkflow/postgres";

import { DATA_PLANE_SCHEMA_NAME, SandboxInstanceStatuses } from "@mistle/db/data-plane";
import {
  DATA_PLANE_MIGRATIONS_FOLDER_PATH,
  MigrationTracking,
  runDataPlaneMigrations,
} from "@mistle/db/migrator";
import { SandboxProvider, createSandboxAdapter, type SandboxAdapter } from "@mistle/sandbox";
import { startPostgresWithPgBouncer } from "@mistle/test-harness";
import postgres from "postgres";
import { it as vitestIt } from "vitest";

import {
  createDataPlaneBackend,
  createDataPlaneOpenWorkflow,
  createDataPlaneWorker,
} from "../../src/data-plane/index.js";

export type DataPlaneWorkflowFixture = {
  sql: ReturnType<typeof postgres>;
  openWorkflow: ReturnType<typeof createDataPlaneOpenWorkflow>;
  sandboxAdapter: SandboxAdapter;
  startedSandboxIds: string[];
};

function resolveDockerWorkflowIntegrationEnabled(): boolean {
  if (process.env.MISTLE_SANDBOX_INTEGRATION !== "1") {
    return false;
  }

  const configuredProviders = (process.env.MISTLE_SANDBOX_INTEGRATION_PROVIDERS ?? "")
    .split(",")
    .map((provider) => provider.trim())
    .filter((provider) => provider.length > 0);

  return configuredProviders.includes(SandboxProvider.DOCKER);
}

function requireDockerSocketPath(): string {
  const socketPath = process.env.MISTLE_SANDBOX_DOCKER_SOCKET_PATH?.trim();

  if (socketPath === undefined || socketPath.length === 0) {
    throw new Error(
      'MISTLE_SANDBOX_DOCKER_SOCKET_PATH is required when workflow Docker integration is enabled via MISTLE_SANDBOX_INTEGRATION=1 and MISTLE_SANDBOX_INTEGRATION_PROVIDERS includes "docker".',
    );
  }

  return socketPath;
}

export const dockerStartSandboxWorkflowIntegrationEnabled =
  resolveDockerWorkflowIntegrationEnabled();

export const it = vitestIt.extend<{ fixture: DataPlaneWorkflowFixture }>({
  fixture: [
    async ({}, use) => {
      if (!dockerStartSandboxWorkflowIntegrationEnabled) {
        throw new Error(
          'Docker workflow integration fixture requested while docker provider integration is disabled. Set MISTLE_SANDBOX_INTEGRATION=1 and include "docker" in MISTLE_SANDBOX_INTEGRATION_PROVIDERS.',
        );
      }

      const cleanupTasks: Array<() => Promise<void>> = [];
      const startedSandboxIds: string[] = [];
      let sandboxAdapter: SandboxAdapter | undefined;

      try {
        const dockerSocketPath = requireDockerSocketPath();
        const databaseStack = await startPostgresWithPgBouncer({
          databaseName: "mistle_workflows_test",
        });
        cleanupTasks.unshift(async () => {
          await databaseStack.stop();
        });

        await runDataPlaneMigrations({
          connectionString: databaseStack.directUrl,
          schemaName: DATA_PLANE_SCHEMA_NAME,
          migrationsFolder: DATA_PLANE_MIGRATIONS_FOLDER_PATH,
          migrationsSchema: MigrationTracking.DATA_PLANE.SCHEMA_NAME,
          migrationsTable: MigrationTracking.DATA_PLANE.TABLE_NAME,
        });

        const backend: BackendPostgres = await createDataPlaneBackend({
          url: databaseStack.directUrl,
          namespaceId: "data-plane-tests",
          runMigrations: true,
        });
        cleanupTasks.unshift(async () => {
          await backend.stop();
        });

        const sql = postgres(databaseStack.directUrl, {
          max: 1,
        });
        cleanupTasks.unshift(async () => {
          await sql.end({ timeout: 5 });
        });

        const dockerSandboxAdapter = createSandboxAdapter({
          provider: SandboxProvider.DOCKER,
          docker: {
            socketPath: dockerSocketPath,
            snapshotRepository: "mistle/workflows-integration/snapshots",
          },
        });
        sandboxAdapter = dockerSandboxAdapter;

        const openWorkflow = createDataPlaneOpenWorkflow({ backend });
        const worker: Worker = createDataPlaneWorker({
          openWorkflow,
          concurrency: 1,
          workflowInputs: {
            startSandboxInstance: {
              startSandbox: async (workflowInput) => {
                const startedSandbox = await dockerSandboxAdapter.start({
                  image: workflowInput.image,
                });

                startedSandboxIds.push(startedSandbox.sandboxId);

                return {
                  provider: startedSandbox.provider,
                  providerSandboxId: startedSandbox.sandboxId,
                };
              },
              stopSandbox: async (workflowInput) => {
                await dockerSandboxAdapter.stop({
                  sandboxId: workflowInput.providerSandboxId,
                });
              },
              insertSandboxInstance: async (workflowInput) => {
                const insertedRows = await sql<{ id: string }[]>`
                  insert into data_plane.sandbox_instances (
                    organization_id,
                    sandbox_profile_id,
                    sandbox_profile_version,
                    manifest,
                    provider,
                    provider_sandbox_id,
                    status,
                    started_by_kind,
                    started_by_id,
                    source,
                    started_at
                  )
                  values (
                    ${workflowInput.organizationId},
                    ${workflowInput.sandboxProfileId},
                    ${workflowInput.sandboxProfileVersion},
                    ${JSON.stringify(workflowInput.manifest)}::jsonb,
                    ${workflowInput.provider},
                    ${workflowInput.providerSandboxId},
                    ${SandboxInstanceStatuses.RUNNING},
                    ${workflowInput.startedBy.kind},
                    ${workflowInput.startedBy.id},
                    ${workflowInput.source},
                    now()
                  )
                  returning id
                `;

                const insertedRow = insertedRows[0];
                if (insertedRow === undefined) {
                  throw new Error("Failed to insert sandbox instance row in integration fixture.");
                }

                return {
                  sandboxInstanceId: insertedRow.id,
                };
              },
            },
          },
        });
        await worker.start();
        cleanupTasks.unshift(async () => {
          await worker.stop();
        });

        await use({
          sql,
          openWorkflow,
          sandboxAdapter: dockerSandboxAdapter,
          startedSandboxIds,
        });
      } finally {
        const uniqueStartedSandboxIds = Array.from(new Set(startedSandboxIds));
        if (sandboxAdapter !== undefined) {
          const cleanupSandboxAdapter = sandboxAdapter;
          const sandboxStopResults = await Promise.allSettled(
            uniqueStartedSandboxIds.map((sandboxId) => cleanupSandboxAdapter.stop({ sandboxId })),
          );

          for (const stopResult of sandboxStopResults) {
            if (stopResult.status === "rejected") {
              // Best-effort cleanup in shared Docker daemon environments.
            }
          }
        }

        for (const cleanupTask of cleanupTasks) {
          await cleanupTask();
        }
      }
    },
    {
      scope: "file",
    },
  ],
});
