import { createDataPlaneSandboxInstancesClient } from "@mistle/data-plane-trpc/client";
import { sandboxProfiles } from "@mistle/db/control-plane";
import { SMTPEmailSender } from "@mistle/emails";
import {
  ControlPlaneWorkerWorkflowIds,
  createControlPlaneWorker,
  type StartSandboxProfileInstanceWorkflowInput,
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

async function verifySandboxProfileVersionExists(input: {
  organizationId: string;
  sandboxProfileId: string;
  sandboxProfileVersion: number;
  resources: Pick<WorkerRuntimeResources, "db">;
}): Promise<void> {
  const sandboxProfile = await input.resources.db.query.sandboxProfiles.findFirst({
    columns: {
      id: true,
    },
    where: (table, { and: whereAnd, eq: whereEq }) =>
      whereAnd(
        whereEq(table.id, input.sandboxProfileId),
        whereEq(table.organizationId, input.organizationId),
      ),
  });
  if (sandboxProfile === undefined) {
    throw new Error("Sandbox profile was not found.");
  }

  const sandboxProfileVersion = await input.resources.db.query.sandboxProfileVersions.findFirst({
    columns: {
      sandboxProfileId: true,
    },
    where: (table, { and: whereAnd, eq: whereEq }) =>
      whereAnd(
        whereEq(table.sandboxProfileId, input.sandboxProfileId),
        whereEq(table.version, input.sandboxProfileVersion),
      ),
  });
  if (sandboxProfileVersion === undefined) {
    throw new Error("Sandbox profile version was not found.");
  }
}

async function startSandboxProfileInstance(input: {
  resources: Pick<WorkerRuntimeResources, "db">;
  dataPlaneSandboxInstancesClient: ReturnType<typeof createDataPlaneSandboxInstancesClient>;
  workflowInput: StartSandboxProfileInstanceWorkflowInput;
}): Promise<{
  workflowRunId: string;
  sandboxInstanceId: string;
  providerSandboxId: string;
}> {
  await verifySandboxProfileVersionExists({
    resources: input.resources,
    organizationId: input.workflowInput.organizationId,
    sandboxProfileId: input.workflowInput.sandboxProfileId,
    sandboxProfileVersion: input.workflowInput.sandboxProfileVersion,
  });

  return input.dataPlaneSandboxInstancesClient.startSandboxInstance(input.workflowInput);
}

export function createRuntimeWorker(ctx: {
  config: ControlPlaneWorkerConfig;
  internalAuthServiceToken: string;
  resources: Pick<WorkerRuntimeResources, "db" | "openWorkflow">;
}): ReturnType<typeof createControlPlaneWorker> {
  const emailSender = createEmailSender(ctx.config);
  const dataPlaneSandboxInstancesClient = createDataPlaneSandboxInstancesClient({
    baseUrl: ctx.config.dataPlaneApi.baseUrl,
    serviceToken: ctx.internalAuthServiceToken,
  });

  return createControlPlaneWorker({
    openWorkflow: ctx.resources.openWorkflow,
    maxConcurrentWorkflows: ctx.config.workflow.concurrency,
    enabledWorkflows: [
      ControlPlaneWorkerWorkflowIds.SEND_ORGANIZATION_INVITATION,
      ControlPlaneWorkerWorkflowIds.SEND_VERIFICATION_OTP,
      ControlPlaneWorkerWorkflowIds.REQUEST_DELETE_SANDBOX_PROFILE,
      ControlPlaneWorkerWorkflowIds.START_SANDBOX_PROFILE_INSTANCE,
    ],
    services: {
      emailDelivery: {
        emailSender,
        from: {
          email: ctx.config.email.fromAddress,
          name: ctx.config.email.fromName,
        },
      },
      sandboxProfiles: {
        deleteSandboxProfile: async (input) => {
          await ctx.resources.db
            .delete(sandboxProfiles)
            .where(
              and(
                eq(sandboxProfiles.id, input.profileId),
                eq(sandboxProfiles.organizationId, input.organizationId),
              ),
            );
        },
      },
      sandboxInstances: {
        startSandboxProfileInstance: async (workflowInput) => {
          return startSandboxProfileInstance({
            resources: ctx.resources,
            dataPlaneSandboxInstancesClient,
            workflowInput,
          });
        },
      },
    },
  });
}
