import { randomUUID } from "node:crypto";

import { startControlPlaneApiTestingRuntime } from "@mistle/control-plane-api/testing";
import { startControlPlaneWorkerTestingRuntime } from "@mistle/control-plane-worker/testing";
import { startDataPlaneApiTestingRuntime } from "@mistle/data-plane-api/testing";
import {
  SandboxInstanceStatuses,
  createDataPlaneDatabase,
  sandboxInstanceRuntimePlans,
  sandboxInstances,
} from "@mistle/db/data-plane";
import { reserveAvailablePort, startMailpit, startPostgresWithPgBouncer } from "@mistle/test-core";
import {
  type CreateStartSandboxInstanceWorkflowInput,
  createDataPlaneBackend,
  createDataPlaneOpenWorkflow,
  createDataPlaneWorker,
} from "@mistle/workflows/data-plane";
import { and, eq, sql } from "drizzle-orm";
import { Pool } from "pg";

import { runCleanupTasks, type CleanupTask } from "../backend-integration/cleanup.js";
import type { StartSystemEnvironmentInput, SystemEnvironment } from "./types.js";

const DefaultHost = "127.0.0.1";
type InsertSandboxInstanceInput = Parameters<
  CreateStartSandboxInstanceWorkflowInput["insertSandboxInstance"]
>[0];
type UpdateSandboxInstanceStatusInput = Parameters<
  CreateStartSandboxInstanceWorkflowInput["updateSandboxInstanceStatus"]
>[0];

function normalizeError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

function createWorkflowNamespaceId(): string {
  return `system_${randomUUID().replaceAll("-", "_")}`;
}

function createControlPlaneDatabaseName(): string {
  return `mistle_system_${randomUUID().replaceAll("-", "_")}`;
}

function createHttpRequest(input: {
  baseUrl: string;
  serviceName: "control-plane-api" | "data-plane-api";
}) {
  return async (path: string, init?: RequestInit): Promise<Response> => {
    if (!path.startsWith("/")) {
      throw new Error(
        `Expected ${input.serviceName} request path to start with '/'. Received '${path}'.`,
      );
    }

    return fetch(new URL(path, input.baseUrl), init);
  };
}

async function startDataPlaneWorkflowWorker(input: {
  databaseDirectUrl: string;
  workflowNamespaceId: string;
}): Promise<{ stop: () => Promise<void> }> {
  const dbPool = new Pool({
    connectionString: input.databaseDirectUrl,
  });
  const db = createDataPlaneDatabase(dbPool);

  const runtimeCleanupTasks: Array<() => Promise<void>> = [];

  try {
    const workflowBackend = await createDataPlaneBackend({
      url: input.databaseDirectUrl,
      namespaceId: input.workflowNamespaceId,
      runMigrations: false,
    });
    runtimeCleanupTasks.unshift(async () => {
      await workflowBackend.stop();
    });

    const openWorkflow = createDataPlaneOpenWorkflow({
      backend: workflowBackend,
    });

    const worker = createDataPlaneWorker({
      openWorkflow,
      concurrency: 1,
      workflowInputs: {
        startSandboxInstance: {
          startSandbox: async () => {
            return {
              provider: "docker",
              providerSandboxId: `system-${randomUUID()}`,
              bootstrapTokenJti: randomUUID(),
            };
          },
          stopSandbox: async () => {},
          insertSandboxInstance: async (workflowInput: InsertSandboxInstanceInput) => {
            return db.transaction(async (tx) => {
              const insertedRows = await tx
                .insert(sandboxInstances)
                .values({
                  organizationId: workflowInput.organizationId,
                  sandboxProfileId: workflowInput.sandboxProfileId,
                  sandboxProfileVersion: workflowInput.sandboxProfileVersion,
                  provider: workflowInput.provider,
                  providerSandboxId: workflowInput.providerSandboxId,
                  status: SandboxInstanceStatuses.STARTING,
                  startedByKind: workflowInput.startedBy.kind,
                  startedById: workflowInput.startedBy.id,
                  source: workflowInput.source,
                })
                .returning({
                  id: sandboxInstances.id,
                });

              const insertedSandboxInstance = insertedRows[0];
              if (insertedSandboxInstance === undefined) {
                throw new Error("Expected sandbox instance insert to return one row.");
              }

              await tx.insert(sandboxInstanceRuntimePlans).values({
                sandboxInstanceId: insertedSandboxInstance.id,
                revision: 1,
                compiledRuntimePlan: workflowInput.runtimePlan,
                compiledFromProfileId: workflowInput.sandboxProfileId,
                compiledFromProfileVersion: workflowInput.sandboxProfileVersion,
              });

              return {
                sandboxInstanceId: insertedSandboxInstance.id,
              };
            });
          },
          waitForSandboxTunnelConnectAck: async () => {
            return true;
          },
          updateSandboxInstanceStatus: async (workflowInput: UpdateSandboxInstanceStatusInput) => {
            if (workflowInput.status === "running") {
              const updatedRows = await db
                .update(sandboxInstances)
                .set({
                  status: SandboxInstanceStatuses.RUNNING,
                  startedAt: sql`now()`,
                  failedAt: null,
                  failureCode: null,
                  failureMessage: null,
                  updatedAt: sql`now()`,
                })
                .where(
                  and(
                    eq(sandboxInstances.id, workflowInput.sandboxInstanceId),
                    eq(sandboxInstances.status, SandboxInstanceStatuses.STARTING),
                  ),
                )
                .returning({
                  id: sandboxInstances.id,
                });

              if (updatedRows[0] === undefined) {
                throw new Error(
                  "Expected sandbox instance status transition from starting to running.",
                );
              }
              return;
            }

            const updatedRows = await db
              .update(sandboxInstances)
              .set({
                status: SandboxInstanceStatuses.FAILED,
                failedAt: sql`now()`,
                failureCode: workflowInput.failureCode,
                failureMessage: workflowInput.failureMessage,
                updatedAt: sql`now()`,
              })
              .where(
                and(
                  eq(sandboxInstances.id, workflowInput.sandboxInstanceId),
                  eq(sandboxInstances.status, SandboxInstanceStatuses.STARTING),
                ),
              )
              .returning({
                id: sandboxInstances.id,
              });

            if (updatedRows[0] === undefined) {
              throw new Error(
                "Expected sandbox instance status transition from starting to failed.",
              );
            }
          },
        },
      },
    });
    await worker.start();
    runtimeCleanupTasks.unshift(async () => {
      await worker.stop();
    });

    return {
      stop: async () => {
        for (const cleanupTask of runtimeCleanupTasks) {
          await cleanupTask();
        }
        await dbPool.end();
      },
    };
  } catch (startupError) {
    for (const cleanupTask of runtimeCleanupTasks) {
      await cleanupTask().catch(() => {});
    }

    await dbPool.end().catch(() => {});
    throw startupError;
  }
}

export async function startSystemEnvironment(
  input: StartSystemEnvironmentInput = {},
): Promise<SystemEnvironment> {
  const workflowNamespaceId = input.workflowNamespaceId ?? createWorkflowNamespaceId();
  const internalAuthServiceToken = input.internalAuthServiceToken ?? "integration-service-token";

  if (workflowNamespaceId.length === 0) {
    throw new Error("A non-empty workflow namespace id is required.");
  }
  if (input.controlPlanePostgres !== undefined && input.dataPlanePostgres !== undefined) {
    throw new Error(
      "System environment accepts either controlPlanePostgres or dataPlanePostgres overrides, but not both.",
    );
  }

  const cleanupTasks: CleanupTask[] = [];
  let stopped = false;

  try {
    const databaseStack = await startPostgresWithPgBouncer({
      databaseName: createControlPlaneDatabaseName(),
      ...(input.controlPlanePostgres ?? input.dataPlanePostgres),
    });
    cleanupTasks.unshift({
      label: "postgres-stack",
      run: async () => {
        await databaseStack.stop();
      },
    });

    const controlPlaneDatabaseStack = databaseStack;
    const dataPlaneDatabaseStack = databaseStack;

    const mailpitService = await startMailpit();
    cleanupTasks.unshift({
      label: "mailpit",
      run: async () => {
        await mailpitService.stop();
      },
    });

    const dataPlanePort = await reserveAvailablePort({ host: DefaultHost });
    const dataPlaneApiRuntime = await startDataPlaneApiTestingRuntime({
      databaseDirectUrl: dataPlaneDatabaseStack.directUrl,
      databasePooledUrl: dataPlaneDatabaseStack.pooledUrl,
      workflowNamespaceId,
      internalAuthServiceToken,
      server: {
        host: DefaultHost,
        port: dataPlanePort,
      },
    });
    await dataPlaneApiRuntime.start();
    cleanupTasks.unshift({
      label: "data-plane-api-runtime",
      run: async () => {
        await dataPlaneApiRuntime.stop();
      },
    });

    const dataPlaneWorkflowWorker = await startDataPlaneWorkflowWorker({
      databaseDirectUrl: dataPlaneDatabaseStack.directUrl,
      workflowNamespaceId,
    });
    cleanupTasks.unshift({
      label: "data-plane-workflow-worker",
      run: async () => {
        await dataPlaneWorkflowWorker.stop();
      },
    });

    const dataPlaneBaseUrl = `http://${DefaultHost}:${String(dataPlanePort)}`;

    const controlPlanePort = await reserveAvailablePort({ host: DefaultHost });
    const controlPlaneApiRuntime = await startControlPlaneApiTestingRuntime({
      databaseDirectUrl: controlPlaneDatabaseStack.directUrl,
      databasePooledUrl: controlPlaneDatabaseStack.pooledUrl,
      workflowNamespaceId,
      internalAuthServiceToken,
      server: {
        host: DefaultHost,
        port: controlPlanePort,
      },
      dataPlaneApi: {
        baseUrl: dataPlaneBaseUrl,
      },
    });
    await controlPlaneApiRuntime.start();
    cleanupTasks.unshift({
      label: "control-plane-api-runtime",
      run: async () => {
        await controlPlaneApiRuntime.stop();
      },
    });

    const controlPlaneWorkerRuntime = await startControlPlaneWorkerTestingRuntime({
      databaseDirectUrl: controlPlaneDatabaseStack.directUrl,
      workflowNamespaceId,
      internalAuthServiceToken,
      smtp: {
        host: mailpitService.smtpHost,
        port: mailpitService.smtpPort,
        secure: false,
        username: "",
        password: "",
      },
      dataPlaneApi: {
        baseUrl: dataPlaneBaseUrl,
      },
    });
    cleanupTasks.unshift({
      label: "control-plane-worker-runtime",
      run: async () => {
        await controlPlaneWorkerRuntime.stop();
      },
    });

    const controlPlaneBaseUrl = `http://${DefaultHost}:${String(controlPlanePort)}`;

    return {
      workflowNamespaceId,
      internalAuthServiceToken,
      controlPlaneBaseUrl,
      dataPlaneBaseUrl,
      controlPlaneDatabaseStack,
      dataPlaneDatabaseStack,
      mailpitService,
      controlPlaneApiRuntime,
      controlPlaneWorkerRuntime,
      dataPlaneApiRuntime,
      requestControlPlane: createHttpRequest({
        baseUrl: controlPlaneBaseUrl,
        serviceName: "control-plane-api",
      }),
      requestDataPlane: createHttpRequest({
        baseUrl: dataPlaneBaseUrl,
        serviceName: "data-plane-api",
      }),
      stop: async () => {
        if (stopped) {
          throw new Error("System environment was already stopped.");
        }

        stopped = true;
        await runCleanupTasks(cleanupTasks);
      },
    };
  } catch (startupError) {
    try {
      await runCleanupTasks(cleanupTasks);
    } catch (cleanupError) {
      throw new AggregateError(
        [normalizeError(startupError), normalizeError(cleanupError)],
        "Failed to start system environment and failed during rollback cleanup.",
      );
    }

    throw startupError;
  }
}
