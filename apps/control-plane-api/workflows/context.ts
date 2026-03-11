import { AppIds, loadConfig } from "@mistle/config";
import {
  createDataPlaneSandboxInstancesClient,
  type DataPlaneSandboxInstancesClient,
} from "@mistle/data-plane-trpc/client";
import { createControlPlaneDatabase, type ControlPlaneDatabase } from "@mistle/db/control-plane";
import { SMTPEmailSender } from "@mistle/emails";
import type { IntegrationRegistry } from "@mistle/integrations-core";
import { createIntegrationRegistry } from "@mistle/integrations-definitions";
import {
  createControlPlaneBackend,
  createControlPlaneOpenWorkflow,
} from "@mistle/workflows/control-plane";
import { Pool } from "pg";

import type { ControlPlaneApiConfig } from "../src/types.js";

export type WorkflowContext = {
  db: ControlPlaneDatabase;
  dataPlaneClient: Pick<DataPlaneSandboxInstancesClient, "startSandboxInstance">;
  integrationsConfig: ControlPlaneApiConfig["integrations"];
  integrationRegistry: IntegrationRegistry;
  openWorkflow: ReturnType<typeof createControlPlaneOpenWorkflow>;
  email: {
    from: {
      email: string;
      name: string;
    };
    sender: SMTPEmailSender;
  };
};

let workflowContextPromise: Promise<WorkflowContext> | undefined;

export function getWorkflowContext(): Promise<WorkflowContext> {
  if (workflowContextPromise !== undefined) {
    return workflowContextPromise;
  }

  workflowContextPromise = Promise.resolve().then(async () => {
    const apiConfig = loadConfig({
      app: AppIds.CONTROL_PLANE_API,
      env: process.env,
    });
    const workerConfig = loadConfig({
      app: AppIds.CONTROL_PLANE_WORKER,
      env: process.env,
      includeGlobal: false,
    });

    if (apiConfig.global === undefined) {
      throw new Error("Expected control-plane API global config for workflow context.");
    }

    const dbPool = new Pool({
      connectionString: apiConfig.app.database.url,
    });
    const workflowBackendPromise = createControlPlaneBackend({
      url: apiConfig.app.workflow.databaseUrl,
      namespaceId: apiConfig.app.workflow.namespaceId,
      runMigrations: false,
    });

    return {
      db: createControlPlaneDatabase(dbPool),
      dataPlaneClient: createDataPlaneSandboxInstancesClient({
        baseUrl: apiConfig.app.dataPlaneApi.baseUrl,
        serviceToken: apiConfig.global.internalAuth.serviceToken,
      }),
      integrationsConfig: apiConfig.app.integrations,
      integrationRegistry: createIntegrationRegistry(),
      openWorkflow: createControlPlaneOpenWorkflow({
        backend: await workflowBackendPromise,
      }),
      email: {
        from: {
          email: workerConfig.app.email.fromAddress,
          name: workerConfig.app.email.fromName,
        },
        sender: SMTPEmailSender.fromTransportOptions({
          host: workerConfig.app.email.smtpHost,
          port: workerConfig.app.email.smtpPort,
          secure: workerConfig.app.email.smtpSecure,
          auth: {
            user: workerConfig.app.email.smtpUsername,
            pass: workerConfig.app.email.smtpPassword,
          },
        }),
      },
    };
  });

  return workflowContextPromise;
}
