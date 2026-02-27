import { createDataPlaneSandboxInstancesClient } from "@mistle/data-plane-trpc/client";
import { StartSandboxInstanceImageSchema } from "@mistle/data-plane-trpc/contracts";
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

type ResolveSandboxProfileVersionInput = {
  db: WorkerRuntimeResources["db"];
  organizationId: string;
  sandboxProfileId: string;
  sandboxProfileVersion: number;
};

type ResolvedSandboxStartSpec = {
  manifest: Record<string, unknown>;
  image: ReturnType<typeof StartSandboxInstanceImageSchema.parse>;
};

function resolveSandboxStartImage(input: {
  manifest: Record<string, unknown>;
}): ReturnType<typeof StartSandboxInstanceImageSchema.parse> {
  // Keep image selection isolated behind this resolver so we can add
  // snapshot/base/default strategies without changing workflow wiring.
  const parsedImage = StartSandboxInstanceImageSchema.safeParse(input.manifest.image);
  if (!parsedImage.success) {
    throw new Error("Sandbox profile version image is invalid.");
  }

  return parsedImage.data;
}

async function resolveSandboxStartSpec(
  input: ResolveSandboxProfileVersionInput,
): Promise<ResolvedSandboxStartSpec> {
  const sandboxProfile = await input.db.query.sandboxProfiles.findFirst({
    columns: {
      id: true,
    },
    where: (table, { and, eq }) =>
      and(eq(table.id, input.sandboxProfileId), eq(table.organizationId, input.organizationId)),
  });

  if (sandboxProfile === undefined) {
    throw new Error("Sandbox profile was not found.");
  }

  const sandboxProfileVersion = await input.db.query.sandboxProfileVersions.findFirst({
    columns: {
      manifest: true,
    },
    where: (table, { and, eq }) =>
      and(
        eq(table.sandboxProfileId, input.sandboxProfileId),
        eq(table.version, input.sandboxProfileVersion),
      ),
  });

  if (sandboxProfileVersion === undefined) {
    throw new Error("Sandbox profile version was not found.");
  }

  if (!isRecord(sandboxProfileVersion.manifest)) {
    throw new Error("Sandbox profile version manifest is invalid.");
  }

  return {
    manifest: sandboxProfileVersion.manifest,
    image: resolveSandboxStartImage({
      manifest: sandboxProfileVersion.manifest,
    }),
  };
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
    startSandboxProfileInstance: {
      resolveSandboxProfileVersion: async (resolveInput) =>
        resolveSandboxStartSpec({
          db: ctx.db,
          organizationId: resolveInput.organizationId,
          sandboxProfileId: resolveInput.sandboxProfileId,
          sandboxProfileVersion: resolveInput.sandboxProfileVersion,
        }),
      startSandboxInstance: async (startInput) => {
        const response = await dataPlaneSandboxInstancesClient.startSandboxInstance(startInput);

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
