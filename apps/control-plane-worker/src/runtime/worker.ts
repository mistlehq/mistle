import { createDataPlaneSandboxInstancesClient } from "@mistle/data-plane-trpc/client";
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

type ResolveSandboxProfileVersionInput = {
  db: WorkerRuntimeResources["db"];
  organizationId: string;
  sandboxProfileId: string;
  sandboxProfileVersion: number;
};

async function verifySandboxProfileVersionExists(
  ctx: ResolveSandboxProfileVersionInput,
): Promise<void> {
  const sandboxProfile = await ctx.db.query.sandboxProfiles.findFirst({
    columns: {
      id: true,
    },
    where: (table, { and, eq }) =>
      and(eq(table.id, ctx.sandboxProfileId), eq(table.organizationId, ctx.organizationId)),
  });

  if (sandboxProfile === undefined) {
    throw new Error("Sandbox profile was not found.");
  }

  const sandboxProfileVersion = await ctx.db.query.sandboxProfileVersions.findFirst({
    columns: {
      sandboxProfileId: true,
    },
    where: (table, { and, eq }) =>
      and(
        eq(table.sandboxProfileId, ctx.sandboxProfileId),
        eq(table.version, ctx.sandboxProfileVersion),
      ),
  });

  if (sandboxProfileVersion === undefined) {
    throw new Error("Sandbox profile version was not found.");
  }
}

function createWorkflowInputs(ctx: {
  config: ControlPlaneWorkerConfig;
  internalAuthServiceToken: string;
  db: WorkerRuntimeResources["db"];
  emailSender: SMTPEmailSender;
}): CreateControlPlaneWorkflowDefinitionsInput {
  const dataPlaneSandboxInstancesClient = createDataPlaneSandboxInstancesClient({
    baseUrl: ctx.config.dataPlaneApi.baseUrl,
    serviceToken: ctx.internalAuthServiceToken,
  });

  return {
    sendOrganizationInvitation: {
      emailSender: ctx.emailSender,
      from: {
        email: ctx.config.email.fromAddress,
        name: ctx.config.email.fromName,
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
      deleteSandboxProfile: async (input) => {
        await ctx.db
          .delete(sandboxProfiles)
          .where(
            and(
              eq(sandboxProfiles.id, input.profileId),
              eq(sandboxProfiles.organizationId, input.organizationId),
            ),
          );
      },
    },
    startSandboxProfileInstance: {
      startSandboxInstance: async (input) => {
        await verifySandboxProfileVersionExists({
          db: ctx.db,
          organizationId: input.organizationId,
          sandboxProfileId: input.sandboxProfileId,
          sandboxProfileVersion: input.sandboxProfileVersion,
        });

        const response = await dataPlaneSandboxInstancesClient.startSandboxInstance(input);

        return {
          workflowRunId: response.workflowRunId,
          sandboxInstanceId: response.sandboxInstanceId,
          providerSandboxId: response.providerSandboxId,
        };
      },
    },
  };
}

export function createRuntimeWorker(ctx: {
  config: ControlPlaneWorkerConfig;
  internalAuthServiceToken: string;
  resources: Pick<WorkerRuntimeResources, "db" | "openWorkflow">;
}): ReturnType<typeof createControlPlaneWorker> {
  const emailSender = createEmailSender(ctx.config);

  return createControlPlaneWorker({
    openWorkflow: ctx.resources.openWorkflow,
    concurrency: ctx.config.workflow.concurrency,
    workflowInputs: createWorkflowInputs({
      config: ctx.config,
      internalAuthServiceToken: ctx.internalAuthServiceToken,
      db: ctx.resources.db,
      emailSender,
    }),
  });
}
