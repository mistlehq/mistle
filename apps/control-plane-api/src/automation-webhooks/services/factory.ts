import { createWebhookAutomation } from "./create-webhook-automation.js";
import { deleteWebhookAutomation } from "./delete-webhook-automation.js";
import { getWebhookAutomation } from "./get-webhook-automation.js";
import { listWebhookAutomations } from "./list-webhook-automations.js";
import type { AutomationWebhooksService, CreateAutomationWebhooksServiceInput } from "./types.js";
import { updateWebhookAutomation } from "./update-webhook-automation.js";

export type { AutomationWebhooksService, CreateAutomationWebhooksServiceInput } from "./types.js";
export {
  AutomationWebhooksBadRequestCodes,
  AutomationWebhooksBadRequestError,
  AutomationWebhooksNotFoundCodes,
  AutomationWebhooksNotFoundError,
} from "./errors.js";

export function createAutomationWebhooksService(
  input: CreateAutomationWebhooksServiceInput,
): AutomationWebhooksService {
  return {
    listWebhookAutomations: (serviceInput) =>
      listWebhookAutomations({ db: input.db }, serviceInput),
    createWebhookAutomation: (serviceInput) => createWebhookAutomation(input, serviceInput),
    getWebhookAutomation: (serviceInput) => getWebhookAutomation({ db: input.db }, serviceInput),
    updateWebhookAutomation: (serviceInput) => updateWebhookAutomation(input, serviceInput),
    deleteWebhookAutomation: (serviceInput) =>
      deleteWebhookAutomation({ db: input.db }, serviceInput),
  };
}
