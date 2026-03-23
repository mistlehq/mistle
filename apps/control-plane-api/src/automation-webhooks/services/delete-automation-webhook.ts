import { automations, AutomationKinds, type ControlPlaneDatabase } from "@mistle/db/control-plane";
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
  const deletedRows = await ctx.db
    .delete(automations)
    .where(
      and(
        eq(automations.id, input.automationId),
        eq(automations.organizationId, input.organizationId),
        eq(automations.kind, AutomationKinds.WEBHOOK),
      ),
    )
    .returning({
      id: automations.id,
    });

  if (deletedRows[0] === undefined) {
    throw new NotFoundError("NOT_FOUND", "Webhook automation was not found.");
  }
}
