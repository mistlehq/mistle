import type { ControlPlaneDatabase, ControlPlaneTables } from "@mistle/db/control-plane";
import {
  createWelcomeEmailIdempotencyKey,
  SendWelcomeEmailWorkflowSpec,
} from "@mistle/workflow-registry/control-plane";
import { eq } from "drizzle-orm";

import { logger } from "../../logger.js";
import { type createControlPlaneOpenWorkflow } from "../../openworkflow.js";

type ControlPlaneOpenWorkflow = ReturnType<typeof createControlPlaneOpenWorkflow>;

type WelcomeEmailConfig =
  | { enabled: true; callUrl?: string | undefined }
  | { enabled: false; callUrl?: string | undefined };

type CreateSendWelcomeEmailServiceInput = {
  openWorkflow: ControlPlaneOpenWorkflow;
  config: WelcomeEmailConfig;
};

type SendWelcomeEmailInput = {
  userId: string;
  organizationId: string;
  email: string;
};

export async function isFirstOrganizationMember(input: {
  db: ControlPlaneDatabase;
  table: ControlPlaneTables["members"];
  organizationId: string;
}): Promise<boolean> {
  const members = await input.db
    .select({
      id: input.table.id,
    })
    .from(input.table)
    .where(eq(input.table.organizationId, input.organizationId))
    .limit(2);

  return members.length === 1;
}

export function createSendWelcomeEmailService(input: CreateSendWelcomeEmailServiceInput) {
  return async (welcomeInput: SendWelcomeEmailInput): Promise<void> => {
    if (!input.config.enabled) {
      return;
    }

    try {
      const workflowInput =
        input.config.callUrl === undefined
          ? {
              email: welcomeInput.email,
            }
          : {
              email: welcomeInput.email,
              callUrl: input.config.callUrl,
            };

      await input.openWorkflow.runWorkflow(SendWelcomeEmailWorkflowSpec, workflowInput, {
        idempotencyKey: createWelcomeEmailIdempotencyKey(welcomeInput.organizationId),
      });
    } catch (error) {
      logger.error(
        {
          err: error,
          organizationId: welcomeInput.organizationId,
          userId: welcomeInput.userId,
          workflowName: SendWelcomeEmailWorkflowSpec.name,
        },
        "Failed to enqueue welcome email workflow",
      );
    }
  };
}
