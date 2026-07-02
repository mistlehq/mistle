import { TextEncoder } from "node:util";

import { verifyAndResolveWebhookRequestOrThrow } from "@mistle/integrations-core";
import { describe, expect, it } from "vitest";

import { TelegramDefinition } from "./definition.js";
import { TelegramWebhookEventMetadata } from "./supported-webhook-events.js";
import { verifyTelegramWebhookSecret } from "./webhook.server.js";

const WebhookSecret = "telegram-webhook-secret";

function encodeJson(input: Record<string, unknown>): Uint8Array {
  return new TextEncoder().encode(JSON.stringify(input));
}

function verifyTelegramWebhook(input: {
  payload: Record<string, unknown>;
  secretToken?: string | undefined;
}) {
  return verifyAndResolveWebhookRequestOrThrow({
    definition: TelegramDefinition,
    targetKey: "telegram-default",
    target: {
      familyId: "telegram",
      variantId: "telegram-default",
      enabled: true,
      config: {
        apiBaseUrl: "https://api.telegram.org",
      },
      secrets: {},
    },
    connections: [
      {
        id: "telegram-connection-id",
        status: "active",
        config: {
          connection_method: "telegram-bot",
        },
      },
    ],
    resolveConnectionSecrets: () => ({
      botToken: "123:telegram-token",
    }),
    webhookSourceSecrets: {
      webhookSecret: WebhookSecret,
    },
    headers: {
      "x-telegram-bot-api-secret-token": input.secretToken ?? WebhookSecret,
    },
    rawBody: encodeJson(input.payload),
  });
}

function createTelegramUpdate(providerEventType: string): Record<string, unknown> {
  return {
    update_id: 1001,
    [providerEventType]: {
      message_id: 42,
      chat: {
        id: 123456,
        type: "private",
      },
      date: 1_633_456_789,
      text: "Hello from Telegram",
    },
  };
}

describe("TelegramWebhookHandler", () => {
  it("verifies the Telegram secret token header", () => {
    expect(
      verifyTelegramWebhookSecret({
        webhookSecret: WebhookSecret,
        secretToken: WebhookSecret,
      }),
    ).toEqual({ ok: true });
  });

  it("rejects mismatched Telegram secret token headers", () => {
    expect(
      verifyTelegramWebhookSecret({
        webhookSecret: WebhookSecret,
        secretToken: "wrong-secret",
      }),
    ).toEqual({
      ok: false,
      code: "invalid-signature",
      message: "Telegram webhook secret verification failed.",
    });
  });

  it("normalizes every documented Telegram update field into a Trigger event", async () => {
    await Promise.all(
      TelegramWebhookEventMetadata.map(async (metadata) => {
        const payload = createTelegramUpdate(metadata.providerEventType);
        const resolved = await verifyTelegramWebhook({ payload });

        if (resolved.kind !== "event") {
          throw new Error(`Expected '${metadata.providerEventType}' to resolve to an event.`);
        }

        expect(resolved.connectionId).toBe("telegram-connection-id");
        expect(resolved.event).toEqual({
          externalEventId: "1001",
          externalDeliveryId: "1001",
          providerEventType: metadata.providerEventType,
          eventType: metadata.eventType,
          payload,
          sourceOrderKey: "1001",
        });
      }),
    );
  });

  it("rejects Telegram webhooks without a matching secret token", async () => {
    await expect(
      verifyTelegramWebhook({
        secretToken: "wrong-secret",
        payload: createTelegramUpdate("message"),
      }),
    ).rejects.toThrow("Telegram webhook secret verification failed.");
  });

  it("rejects Telegram updates without a supported update field", async () => {
    await expect(
      verifyTelegramWebhook({
        payload: {
          update_id: 1001,
          unknown_update: {},
        },
      }),
    ).rejects.toThrow("Telegram webhook payload does not contain a supported update field.");
  });

  it("rejects Telegram updates with multiple update fields", async () => {
    await expect(
      verifyTelegramWebhook({
        payload: {
          update_id: 1001,
          message: {},
          callback_query: {},
        },
      }),
    ).rejects.toThrow("Telegram webhook payload contains multiple update fields");
  });
});
