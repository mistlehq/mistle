import { automations, AutomationKinds } from "@mistle/db/control-plane";
import { and, eq } from "drizzle-orm";

import { AutomationWebhooksNotFoundCodes, AutomationWebhooksNotFoundError } from "./errors.js";
import type {
  CreateAutomationWebhooksServiceInput,
  DeleteWebhookAutomationInput,
} from "./types.js";

export async function deleteWebhookAutomation(
  input: Pick<CreateAutomationWebhooksServiceInput, "db">,
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
