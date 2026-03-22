import { automations, AutomationKinds, type ControlPlaneDatabase } from "@mistle/db/control-plane";
import { and, eq } from "drizzle-orm";

import { AutomationWebhooksNotFoundCodes, AutomationWebhooksNotFoundError } from "../errors.js";
import type { DeleteWebhookAutomationInput } from "../types.js";

export async function deleteAutomationWebhook(
  input: { db: ControlPlaneDatabase },
  serviceInput: DeleteWebhookAutomationInput,
) {
  const deletedRows = await input.db
    .delete(automations)
    .where(
      and(
        eq(automations.id, serviceInput.automationId),
        eq(automations.organizationId, serviceInput.organizationId),
        eq(automations.kind, AutomationKinds.WEBHOOK),
      ),
    )
    .returning({
      id: automations.id,
    });

  if (deletedRows[0] === undefined) {
    throw new AutomationWebhooksNotFoundError(
      AutomationWebhooksNotFoundCodes.AUTOMATION_NOT_FOUND,
      "Webhook automation was not found.",
    );
  }
}
