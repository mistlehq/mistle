import { randomUUID } from "node:crypto";

import { SandboxInstanceStatuses } from "@mistle/db/data-plane";
import {
  DATA_PLANE_MIGRATIONS_FOLDER_PATH,
  MigrationTracking,
  runDataPlaneMigrations,
} from "@mistle/db/migrator";
import { SandboxProvider, createSandboxAdapter, type SandboxAdapter } from "@mistle/sandbox";
import { runCleanupTasks, startPostgresWithPgBouncer } from "@mistle/test-harness";
import type { Worker } from "openworkflow";
import type { BackendPostgres } from "openworkflow/postgres";
import postgres from "postgres";
import { it as vitestIt } from "vitest";

import {
  DataPlaneWorkerWorkflowIds,
  createDataPlaneBackend,
  createDataPlaneOpenWorkflow,
  createDataPlaneWorker,
} from "../../src/data-plane/index.js";

export type DataPlaneWorkflowFixture = {
  sql: ReturnType<typeof postgres>;
  openWorkflow: ReturnType<typeof createDataPlaneOpenWorkflow>;
  sandboxAdapter: SandboxAdapter;
  startedSandboxIds: string[];
  startedBootstrapTokenJtis: string[];
};

function normalizeError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

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

const DEFAULT_DOCKER_SOCKET_PATH = "/var/run/docker.sock";
const TunnelConnectAckWaitTimeoutMs = 2_000;
const TunnelConnectAckPollIntervalMs = 100;

function resolveDockerSocketPath(): string {
  const socketPath = process.env.MISTLE_SANDBOX_DOCKER_SOCKET_PATH?.trim();

  if (socketPath === undefined || socketPath.length === 0) {
    return DEFAULT_DOCKER_SOCKET_PATH;
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
      const startedBootstrapTokenJtis: string[] = [];
      let sandboxAdapter: SandboxAdapter | undefined;
      let cleanupFailure: Error | undefined;

      try {
        const dockerSocketPath = resolveDockerSocketPath();
        const databaseStack = await startPostgresWithPgBouncer({
          databaseName: "mistle_workflows_test",
        });
        cleanupTasks.unshift(async () => {
          await databaseStack.stop();
        });

        await runDataPlaneMigrations({
          connectionString: databaseStack.directUrl,
          schemaName: MigrationTracking.DATA_PLANE.SCHEMA_NAME,
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
          maxConcurrentWorkflows: 1,
          enabledWorkflows: [DataPlaneWorkerWorkflowIds.START_SANDBOX_INSTANCE],
          services: {
            startSandboxInstance: {
              sandboxLifecycle: {
                startSandbox: async (workflowInput) => {
                  const startedSandbox = await dockerSandboxAdapter.start({
                    image: {
                      ...workflowInput.image,
                      provider: SandboxProvider.DOCKER,
                    },
                  });
                  const bootstrapTokenJti = randomUUID();
                  const sandboxInstanceId = `sbi_${randomUUID().replaceAll("-", "")}`;

                  startedSandboxIds.push(startedSandbox.sandboxId);
                  startedBootstrapTokenJtis.push(bootstrapTokenJti);

                  return {
                    sandboxInstanceId,
                    provider: startedSandbox.provider,
                    providerSandboxId: startedSandbox.sandboxId,
                    bootstrapTokenJti,
                  };
                },
                stopSandbox: async (workflowInput) => {
                  await dockerSandboxAdapter.stop({
                    sandboxId: workflowInput.providerSandboxId,
                  });
                },
              },
              sandboxInstances: {
                createSandboxInstance: async (workflowInput) => {
                  let insertedRows: Array<{ id: string }>;
                  try {
                    insertedRows = await sql<{ id: string }[]>`
                      insert into data_plane.sandbox_instances (
                        id,
                        organization_id,
                        sandbox_profile_id,
                        sandbox_profile_version,
                        provider,
                        provider_sandbox_id,
                        status,
                        started_by_kind,
                        started_by_id,
                        source
                      )
                      values (
                        ${workflowInput.sandboxInstanceId},
                        ${workflowInput.organizationId},
                        ${workflowInput.sandboxProfileId},
                        ${workflowInput.sandboxProfileVersion},
                        ${workflowInput.provider},
                        ${workflowInput.providerSandboxId},
                        ${SandboxInstanceStatuses.STARTING},
                        ${workflowInput.startedBy.kind},
                        ${workflowInput.startedBy.id},
                        ${workflowInput.source}
                      )
                      returning id
                    `;

                    await sql`
                      insert into data_plane.sandbox_instance_runtime_plans (
                        id,
                        sandbox_instance_id,
                        revision,
                        compiled_runtime_plan,
                        compiled_from_profile_id,
                        compiled_from_profile_version
                      )
                      values (
                        ${`srp_${randomUUID().replaceAll("-", "")}`},
                        ${workflowInput.sandboxInstanceId},
                        ${1},
                        ${sql.json(workflowInput.runtimePlan)},
                        ${workflowInput.sandboxProfileId},
                        ${workflowInput.sandboxProfileVersion}
                      )
                    `;
                  } catch (error) {
                    const rawErrorMessage =
                      error instanceof Error
                        ? `${error.name}: ${error.message}`
                        : `unknown error: ${String(error)}`;
                    throw new Error(
                      `Failed to insert sandbox instance row in integration fixture. ${rawErrorMessage}`,
                    );
                  }

                  const insertedRow = insertedRows[0];
                  if (insertedRow === undefined) {
                    throw new Error(
                      "Failed to insert sandbox instance row in integration fixture.",
                    );
                  }

                  return {
                    sandboxInstanceId: insertedRow.id,
                  };
                },
                markSandboxInstanceRunning: async (workflowInput) => {
                  const updatedRows = await sql<{ id: string }[]>`
                    update data_plane.sandbox_instances
                    set
                      status = ${SandboxInstanceStatuses.RUNNING},
                      started_at = now(),
                      failed_at = null,
                      failure_code = null,
                      failure_message = null,
                      updated_at = now()
                    where
                      id = ${workflowInput.sandboxInstanceId}
                      and status = ${SandboxInstanceStatuses.STARTING}
                    returning id
                  `;
                  if (updatedRows[0] === undefined) {
                    throw new Error(
                      "Failed to transition sandbox instance status from starting to running in integration fixture.",
                    );
                  }
                },
                markSandboxInstanceFailed: async (workflowInput) => {
                  const updatedRows = await sql<{ id: string }[]>`
                    update data_plane.sandbox_instances
                    set
                      status = ${SandboxInstanceStatuses.FAILED},
                      failed_at = now(),
                      failure_code = ${workflowInput.failureCode},
                      failure_message = ${workflowInput.failureMessage},
                      updated_at = now()
                    where
                      id = ${workflowInput.sandboxInstanceId}
                      and status = ${SandboxInstanceStatuses.STARTING}
                    returning id
                  `;
                  if (updatedRows[0] === undefined) {
                    throw new Error(
                      "Failed to transition sandbox instance status from starting to failed in integration fixture.",
                    );
                  }
                },
              },
              tunnelConnectAcks: {
                waitForSandboxTunnelConnectAck: async (workflowInput) => {
                  const waitDeadlineMs = Date.now() + TunnelConnectAckWaitTimeoutMs;

                  while (true) {
                    const ackRows = await sql<{ bootstrap_token_jti: string }[]>`
                      select bootstrap_token_jti
                      from data_plane.sandbox_tunnel_connect_acks
                      where bootstrap_token_jti = ${workflowInput.bootstrapTokenJti}
                    `;
                    if (ackRows[0] !== undefined) {
                      return true;
                    }

                    const remainingMs = waitDeadlineMs - Date.now();
                    if (remainingMs <= 0) {
                      return false;
                    }

                    await sql`select pg_sleep(${Math.min(remainingMs, TunnelConnectAckPollIntervalMs) / 1000})`;
                  }
                },
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
          startedBootstrapTokenJtis,
        });
      } finally {
        const cleanupErrors: Error[] = [];
        const uniqueStartedSandboxIds = Array.from(new Set(startedSandboxIds));
        if (sandboxAdapter !== undefined) {
          const cleanupSandboxAdapter = sandboxAdapter;
          const sandboxStopTasks = uniqueStartedSandboxIds.map(
            (sandboxId) => async () => cleanupSandboxAdapter.stop({ sandboxId }),
          );

          try {
            await runCleanupTasks({
              tasks: sandboxStopTasks,
              context: "workflows data-plane sandbox adapter cleanup",
            });
          } catch (error) {
            cleanupErrors.push(normalizeError(error));
          }
        }

        try {
          await runCleanupTasks({
            tasks: cleanupTasks,
            context: "workflows data-plane fixture cleanup",
          });
        } catch (error) {
          cleanupErrors.push(normalizeError(error));
        }

        if (cleanupErrors.length === 1) {
          const firstError = cleanupErrors[0];
          cleanupFailure = firstError ?? new Error("Expected exactly one cleanup error.");
        } else if (cleanupErrors.length > 1) {
          cleanupFailure = new AggregateError(
            cleanupErrors,
            "Multiple cleanup operations failed in workflows data-plane fixture.",
          );
        }
      }

      if (cleanupFailure !== undefined) {
        throw cleanupFailure;
      }
    },
    {
      scope: "file",
    },
  ],
});
