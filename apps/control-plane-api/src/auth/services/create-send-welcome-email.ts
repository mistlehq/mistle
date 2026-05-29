import type { ControlPlaneDatabase, ControlPlaneTables } from "@mistle/db/control-plane";
import {
  createWelcomeEmailIdempotencyKey,
  SendWelcomeEmailWorkflowSpec,
} from "@mistle/workflow-registry/control-plane";
import { eq } from "drizzle-orm";

import { logger } from "../../logger.js";
import { type createControlPlaneOpenWorkflow } from "../../openworkflow.js";

type ControlPlaneOpenWorkflow = ReturnType<typeof createControlPlaneOpenWorkflow>;

type WelcomeEmailConfig = {
  enabled: boolean;
  callUrl?: string | undefined;
};

type CreateSendWelcomeEmailServiceInput = {
  openWorkflow: ControlPlaneOpenWorkflow;
  db: ControlPlaneDatabase;
  tables: Pick<ControlPlaneTables, "members">;
  config: WelcomeEmailConfig;
};

type SendWelcomeEmailInput = {
  userId: string;
  organizationId: string;
  email: string;
};

async function isFirstOrganizationMember(input: {
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
      const shouldSendWelcomeEmail = await isFirstOrganizationMember({
        db: input.db,
        table: input.tables.members,
        organizationId: welcomeInput.organizationId,
      });
      if (!shouldSendWelcomeEmail) {
        return;
      }

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
        "Failed to evaluate welcome email delivery for created organization",
      );
    }
  };
}
