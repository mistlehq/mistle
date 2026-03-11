import { AppIds, loadConfig } from "@mistle/config";
import {
  createDataPlaneSandboxInstancesClient,
  type DataPlaneSandboxInstancesClient,
} from "@mistle/data-plane-trpc/client";
import { createControlPlaneDatabase, type ControlPlaneDatabase } from "@mistle/db/control-plane";
import { SMTPEmailSender } from "@mistle/emails";
import { Pool } from "pg";

export type WorkflowContext = {
  db: ControlPlaneDatabase;
  dataPlaneClient: Pick<DataPlaneSandboxInstancesClient, "startSandboxInstance">;
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

  workflowContextPromise = Promise.resolve().then(() => {
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

    return {
      db: createControlPlaneDatabase(dbPool),
      dataPlaneClient: createDataPlaneSandboxInstancesClient({
        baseUrl: apiConfig.app.dataPlaneApi.baseUrl,
        serviceToken: apiConfig.global.internalAuth.serviceToken,
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
