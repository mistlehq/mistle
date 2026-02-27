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

function createWorkflowInputs(ctx: {
  config: ControlPlaneWorkerConfig;
  db: WorkerRuntimeResources["db"];
  emailSender: SMTPEmailSender;
}): CreateControlPlaneWorkflowDefinitionsInput {
  return {
    sendOrganizationInvitation: {
      emailSender: input.emailSender,
      from: {
        email: input.config.email.fromAddress,
        name: input.config.email.fromName,
      },
    },
    sendVerificationOTP: {
      emailSender: ctx.emailSender,
      from: {
        email: ctx.config.email.fromAddress,
        name: ctx.config.email.fromName,
      },
    },
    requestDeleteSandboxProfile: {
      deleteSandboxProfile: async (deleteInput) => {
        await ctx.db
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

export function createRuntimeWorker(ctx: {
  config: ControlPlaneWorkerConfig;
  resources: Pick<WorkerRuntimeResources, "db" | "openWorkflow">;
}): ReturnType<typeof createControlPlaneWorker> {
  const emailSender = createEmailSender(ctx.config);

  return createControlPlaneWorker({
    openWorkflow: ctx.resources.openWorkflow,
    concurrency: ctx.config.workflow.concurrency,
    workflowInputs: createWorkflowInputs({
      config: ctx.config,
      db: ctx.resources.db,
      emailSender,
    }),
  });
}
