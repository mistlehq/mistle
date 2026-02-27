import { randomUUID } from "node:crypto";

import { startControlPlaneApiTestingRuntime } from "@mistle/control-plane-api/testing";
import { startControlPlaneWorkerTestingRuntime } from "@mistle/control-plane-worker/testing";
import { startMailpit, startPostgresWithPgBouncer } from "@mistle/test-core";

import { runCleanupTasks, type CleanupTask } from "../cleanup.js";
import { hasIntegrationComponent, resolveIntegrationComponents } from "./capabilities.js";
import type { IntegrationEnvironment, StartIntegrationEnvironmentInput } from "./types.js";

function normalizeError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

function createWorkflowNamespaceId(): string {
  return `integration_${randomUUID().replaceAll("-", "_")}`;
}

function createDefaultDatabaseName(): string {
  return `mistle_integration_${randomUUID().replaceAll("-", "_")}`;
}

function validateStartInput(input: { capabilityCount: number; workflowNamespaceId: string }): void {
  if (input.capabilityCount === 0) {
    throw new Error("At least one control-plane integration capability is required.");
  }

  if (input.workflowNamespaceId.length === 0) {
    throw new Error("A non-empty workflow namespace id is required.");
  }
}

export async function startIntegrationEnvironment(
  input: StartIntegrationEnvironmentInput,
): Promise<IntegrationEnvironment> {
  const workflowNamespaceId = input.workflowNamespaceId ?? createWorkflowNamespaceId();
  const requiredComponents = resolveIntegrationComponents(input.capabilities);

  validateStartInput({
    capabilityCount: input.capabilities.length,
    workflowNamespaceId,
  });

  const cleanupTasks: CleanupTask[] = [];
  let stopped = false;

  try {
    const databaseStack = await startPostgresWithPgBouncer({
      databaseName: createDefaultDatabaseName(),
      ...input.postgres,
    });
    cleanupTasks.unshift({
      label: "postgres-stack",
      run: async () => {
        await databaseStack.stop();
      },
    });

    let mailpitService: Awaited<ReturnType<typeof startMailpit>> | null = null;
    if (hasIntegrationComponent(requiredComponents, "mailpit")) {
      mailpitService = await startMailpit();
      cleanupTasks.unshift({
        label: "mailpit",
        run: async () => {
          await mailpitService?.stop();
        },
      });
    }

    const apiRuntime = await startControlPlaneApiTestingRuntime({
      databaseDirectUrl: databaseStack.directUrl,
      databasePooledUrl: databaseStack.pooledUrl,
      workflowNamespaceId,
    });
    cleanupTasks.unshift({
      label: "control-plane-api-runtime",
      run: async () => {
        await apiRuntime.stop();
      },
    });

    let workerRuntime: IntegrationEnvironment["workerRuntime"] = null;
    if (hasIntegrationComponent(requiredComponents, "control-plane-worker-runtime")) {
      workerRuntime = await startControlPlaneWorkerTestingRuntime({
        databaseDirectUrl: databaseStack.directUrl,
        workflowNamespaceId,
        ...(mailpitService === null
          ? {}
          : {
              smtp: {
                host: mailpitService.smtpHost,
                port: mailpitService.smtpPort,
                secure: false,
                username: "",
                password: "",
              },
            }),
      });
      cleanupTasks.unshift({
        label: "control-plane-worker-runtime",
        run: async () => {
          await workerRuntime?.stop();
        },
      });
    }

    return {
      capabilities: input.capabilities,
      requiredComponents,
      workflowNamespaceId,
      databaseStack,
      mailpitService,
      apiRuntime,
      workerRuntime,
      request: async (path, init) => apiRuntime.request(path, init),
      stop: async () => {
        if (stopped) {
          throw new Error("Control-plane integration environment was already stopped.");
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
        "Failed to start control-plane integration environment and failed during rollback cleanup.",
      );
    }

    throw startupError;
  }
}
