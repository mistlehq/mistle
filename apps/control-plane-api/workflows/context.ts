import { AppIds, loadConfig } from "@mistle/config";
import { createControlPlaneDatabase, type ControlPlaneDatabase } from "@mistle/db/control-plane";
import { SMTPEmailSender } from "@mistle/emails";
import { Pool } from "pg";

export type WorkflowContext = {
  db: ControlPlaneDatabase;
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
      includeGlobal: false,
    });
    const workerConfig = loadConfig({
      app: AppIds.CONTROL_PLANE_WORKER,
      env: process.env,
      includeGlobal: false,
    });
    const dbPool = new Pool({
      connectionString: apiConfig.app.database.url,
    });

    return {
      db: createControlPlaneDatabase(dbPool),
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
