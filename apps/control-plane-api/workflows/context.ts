import { AppIds, loadConfig } from "@mistle/config";
import { ControlPlaneInternalClient } from "@mistle/control-plane-internal-client";
import {
  createDataPlaneSandboxInstancesClient,
  type DataPlaneSandboxInstancesClient,
} from "@mistle/data-plane-trpc/client";
import { createControlPlaneDatabase, type ControlPlaneDatabase } from "@mistle/db/control-plane";
import { SMTPEmailSender } from "@mistle/emails";
import type { IntegrationRegistry } from "@mistle/integrations-core";
import { createIntegrationRegistry } from "@mistle/integrations-definitions";
import { OpenWorkflow } from "openworkflow";
import { BackendPostgres } from "openworkflow/postgres";
import { Pool } from "pg";

import type { ControlPlaneApiConfig } from "../src/types.js";
import { ControlPlaneOpenWorkflowSchema } from "./constants.js";

export type WorkflowContext = {
  db: ControlPlaneDatabase;
  controlPlaneInternalClient: Pick<
    ControlPlaneInternalClient,
    "getSandboxInstance" | "mintSandboxConnectionToken" | "startSandboxProfileInstance"
  >;
  dataPlaneClient: Pick<DataPlaneSandboxInstancesClient, "startSandboxInstance">;
  integrationsConfig: ControlPlaneApiConfig["integrations"];
  integrationRegistry: IntegrationRegistry;
  openWorkflow: OpenWorkflow;
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

    const controlPlaneInternalClient = new ControlPlaneInternalClient({
      baseUrl: apiConfig.app.auth.baseUrl,
      internalAuthServiceToken: apiConfig.global.internalAuth.serviceToken,
    });
    const dbPool = new Pool({
      connectionString: apiConfig.app.database.url,
    });
    const workflowBackendPromise = BackendPostgres.connect(apiConfig.app.workflow.databaseUrl, {
      namespaceId: apiConfig.app.workflow.namespaceId,
      runMigrations: false,
      schema: ControlPlaneOpenWorkflowSchema,
    });

    return {
      db: createControlPlaneDatabase(dbPool),
      controlPlaneInternalClient,
      dataPlaneClient: createDataPlaneSandboxInstancesClient({
        baseUrl: apiConfig.app.dataPlaneApi.baseUrl,
        serviceToken: apiConfig.global.internalAuth.serviceToken,
      }),
      integrationsConfig: apiConfig.app.integrations,
      integrationRegistry: createIntegrationRegistry(),
      openWorkflow: new OpenWorkflow({
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
