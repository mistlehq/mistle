import { sandboxProfiles } from "@mistle/db/control-plane";
import { SMTPEmailSender } from "@mistle/emails";
import {
  createControlPlaneWorker,
  type CreateControlPlaneWorkflowDefinitionsInput,
} from "@mistle/workflows/control-plane";
import { and, eq } from "drizzle-orm";

import type { ControlPlaneWorkerConfig } from "../types.js";
import type { WorkerRuntimeResources } from "./resources.js";

function createEmailSender(config: ControlPlaneWorkerConfig): SMTPEmailSender {
  return SMTPEmailSender.fromTransportOptions({
    host: config.email.smtpHost,
    port: config.email.smtpPort,
    secure: config.email.smtpSecure,
    auth: {
      user: config.email.smtpUsername,
      pass: config.email.smtpPassword,
    },
  });
}

function createWorkflowInputs(input: {
  config: ControlPlaneWorkerConfig;
  db: WorkerRuntimeResources["db"];
  emailSender: SMTPEmailSender;
}): CreateControlPlaneWorkflowDefinitionsInput {
  return {
    sendVerificationOTP: {
      emailSender: input.emailSender,
      from: {
        email: input.config.email.fromAddress,
        name: input.config.email.fromName,
      },
    },
    requestDeleteSandboxProfile: {
      deleteSandboxProfile: async (deleteInput) => {
        await input.db
          .delete(sandboxProfiles)
          .where(
            and(
              eq(sandboxProfiles.id, deleteInput.profileId),
              eq(sandboxProfiles.organizationId, deleteInput.organizationId),
            ),
          );
      },
    },
  };
}

export function createRuntimeWorker(input: {
  config: ControlPlaneWorkerConfig;
  resources: Pick<WorkerRuntimeResources, "db" | "openWorkflow">;
}): ReturnType<typeof createControlPlaneWorker> {
  const emailSender = createEmailSender(input.config);

  return createControlPlaneWorker({
    openWorkflow: input.resources.openWorkflow,
    concurrency: input.config.workflow.concurrency,
    workflowInputs: createWorkflowInputs({
      config: input.config,
      db: input.resources.db,
      emailSender,
    }),
  });
}
