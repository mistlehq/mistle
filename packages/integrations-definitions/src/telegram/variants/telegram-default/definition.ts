import { TelegramConnectionMethodId } from "./auth.js";
import {
  TelegramBaseDefinition,
  type TelegramBaseIntegrationDefinition,
} from "./base-definition.js";
import { validateTelegramFormConnectionCreate } from "./webhook-source.server.js";
import { TelegramWebhookSourceCapability } from "./webhook-source.server.js";
import { TelegramWebhookHandler } from "./webhook.server.js";

export type TelegramIntegrationDefinition = TelegramBaseIntegrationDefinition;

export const TelegramDefinition: TelegramIntegrationDefinition = {
  ...TelegramBaseDefinition,
  connectionMethods: TelegramBaseDefinition.connectionMethods.map((method) =>
    method.id === TelegramConnectionMethodId && method.kind === "form"
      ? {
          ...method,
          validateCreate: validateTelegramFormConnectionCreate,
          postCreate: {
            managedWebhookSource: {
              autoCreate: true,
              failureNoticeTitle: "Connection created, webhook setup failed",
              successNoticeTitle: "Telegram connection and webhook created successfully",
            },
          },
        }
      : method,
  ),
  webhookAcceptedResponse: {
    status: 200,
    body: {
      ok: true,
    },
  },
  webhookHandler: TelegramWebhookHandler,
  webhookSource: TelegramWebhookSourceCapability,
};
