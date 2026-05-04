import {
  AutomationKinds,
  type ControlPlaneDatabase,
  getControlPlaneDatabaseSchema,
} from "@mistle/db/control-plane";
import { NotFoundError } from "@mistle/http/errors.js";
import { and, eq } from "drizzle-orm";

export type DeleteWebhookAutomationInput = {
  organizationId: string;
  automationId: string;
};

export async function deleteAutomationWebhook(
  ctx: { db: ControlPlaneDatabase },
  input: DeleteWebhookAutomationInput,
) {
  const tables = getControlPlaneDatabaseSchema(ctx.db);

  const deletedRows = await ctx.db
    .delete(tables.automations)
    .where(
      and(
        eq(tables.automations.id, input.automationId),
        eq(tables.automations.organizationId, input.organizationId),
        eq(tables.automations.kind, AutomationKinds.WEBHOOK),
      ),
    )
    .returning({
      id: tables.automations.id,
    });

  if (deletedRows[0] === undefined) {
    throw new NotFoundError("NOT_FOUND", "Webhook automation was not found.");
  }
}
