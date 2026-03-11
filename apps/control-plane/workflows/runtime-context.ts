import { ControlPlaneInternalClient } from "@mistle/control-plane-internal-client";
import { createDataPlaneSandboxInstancesClient } from "@mistle/data-plane-trpc/client";
import { createControlPlaneDatabase, type ControlPlaneDatabase } from "@mistle/db/control-plane";
import type { IntegrationRegistry } from "@mistle/integrations-core";
import { createIntegrationRegistry } from "@mistle/integrations-definitions";
import type { BackendPostgres } from "openworkflow/postgres";
import { Pool } from "pg";

import { getControlPlaneWorkerConfig } from "../src/worker/config.js";
import { createEmailSender } from "../src/worker/services/create-email-sender.js";
import { createControlPlaneBackend } from "./backend.js";
import { createControlPlaneOpenWorkflow } from "./client.js";

export type ControlPlaneWorkflowRuntime = {
  controlPlaneInternalClient: ControlPlaneInternalClient;
  dataPlaneSandboxInstancesClient: ReturnType<typeof createDataPlaneSandboxInstancesClient>;
  db: ControlPlaneDatabase;
  dbPool: Pool;
  emailFrom: {
    email: string;
    name: string;
  };
  emailSender: ReturnType<typeof createEmailSender>;
  integrationRegistry: IntegrationRegistry;
  openWorkflow: ReturnType<typeof createControlPlaneOpenWorkflow>;
  workflowBackend: BackendPostgres;
};

let workflowRuntimePromise: Promise<ControlPlaneWorkflowRuntime> | undefined;

async function createControlPlaneWorkflowRuntime(): Promise<ControlPlaneWorkflowRuntime> {
  const { appConfig, globalConfig } = getControlPlaneWorkerConfig();
  const dbPool = new Pool({
    connectionString: appConfig.workflow.databaseUrl,
  });
  const db = createControlPlaneDatabase(dbPool);

  try {
    const workflowBackend = await createControlPlaneBackend({
      url: appConfig.workflow.databaseUrl,
      namespaceId: appConfig.workflow.namespaceId,
      runMigrations: appConfig.workflow.runMigrations,
    });

    return {
      controlPlaneInternalClient: new ControlPlaneInternalClient({
        baseUrl: appConfig.controlPlaneApi.baseUrl,
        internalAuthServiceToken: globalConfig.internalAuth.serviceToken,
      }),
      dataPlaneSandboxInstancesClient: createDataPlaneSandboxInstancesClient({
        baseUrl: appConfig.dataPlaneApi.baseUrl,
        serviceToken: globalConfig.internalAuth.serviceToken,
      }),
      db,
      dbPool,
      emailFrom: {
        email: appConfig.email.fromAddress,
        name: appConfig.email.fromName,
      },
      emailSender: createEmailSender(appConfig),
      integrationRegistry: createIntegrationRegistry(),
      openWorkflow: createControlPlaneOpenWorkflow({
        backend: workflowBackend,
      }),
      workflowBackend,
    };
  } catch (error) {
    await dbPool.end();
    throw error;
  }
}

export function getControlPlaneWorkflowRuntime(): Promise<ControlPlaneWorkflowRuntime> {
  workflowRuntimePromise ??= createControlPlaneWorkflowRuntime();
  return workflowRuntimePromise;
}

export async function getControlPlaneWorkflowBackend(): Promise<BackendPostgres> {
  const runtime = await getControlPlaneWorkflowRuntime();
  return runtime.workflowBackend;
}
