import { TextEncoder } from "node:util";

import { verifyAndResolveWebhookRequestOrThrow } from "@mistle/integrations-core";
import { describe, expect, it } from "vitest";

import { WasenderApiDefinition } from "./definition.js";
import { verifyWasenderApiWebhookSignature } from "./webhook.server.js";

const WebhookSecret = "wasenderapi-webhook-secret";

function encodeJson(input: Record<string, unknown>): Uint8Array {
  return new TextEncoder().encode(JSON.stringify(input));
}

function verifyWasenderApiWebhook(input: { payload: Record<string, unknown>; signature?: string }) {
  return verifyAndResolveWebhookRequestOrThrow({
    definition: WasenderApiDefinition,
    targetKey: "wasenderapi-mcp",
    target: {
      familyId: "wasenderapi",
      variantId: "wasenderapi-mcp",
      enabled: true,
      config: {},
      secrets: {},
    },
    connections: [
      {
        id: "wasenderapi-connection-id",
        status: "active",
        config: {
          connection_method: "api-key",
        },
      },
    ],
    resolveConnectionSecrets: () => ({
      personalAccessToken: "wasenderapi-personal-access-token",
      webhookSecret: WebhookSecret,
    }),
    webhookSourceSecrets: {},
    headers: {
      "x-webhook-signature": input.signature ?? WebhookSecret,
    },
    rawBody: encodeJson(input.payload),
  });
}

describe("WasenderAPI webhook signature helpers", () => {
  it("verifies the shared secret signature header", () => {
    expect(
      verifyWasenderApiWebhookSignature({
        webhookSecret: WebhookSecret,
        signature: WebhookSecret,
      }),
    ).toEqual({ ok: true });
  });

  it("rejects mismatched signature header values", () => {
    expect(
      verifyWasenderApiWebhookSignature({
        webhookSecret: WebhookSecret,
        signature: "wrong-secret",
      }),
    ).toEqual({
      ok: false,
      code: "invalid-signature",
      message: "WasenderAPI webhook signature verification failed.",
    });
  });
});

describe("WasenderApiWebhookHandler", () => {
  it("normalizes documented message received deliveries", async () => {
    const payload = {
      event: "messages.received",
      timestamp: 1_633_456_789,
      data: {
        messages: {
          key: {
            id: "3EB0X123456789",
            fromMe: false,
            remoteJid: "1234567890@s.whatsapp.net",
          },
          messageBody: "Hello, I have a question",
        },
      },
    };
    const resolved = await verifyWasenderApiWebhook({ payload });

    expect(resolved).toEqual({
      kind: "event",
      connectionId: "wasenderapi-connection-id",
      event: {
        externalEventId: "3EB0X123456789",
        externalDeliveryId: "3EB0X123456789",
        providerEventType: "messages.received",
        eventType: "wasenderapi.messages.received",
        payload,
        occurredAt: "2021-10-05T17:59:49.000Z",
        sourceOrderKey: "2021-10-05T17:59:49.000Z#3EB0X123456789",
      },
    });
  });

  it("normalizes documented message upsert deliveries with message arrays", async () => {
    const payload = {
      event: "messages.upsert",
      timestamp: 1_633_456_789,
      data: {
        messages: [
          {
            key: {
              id: "message-id-123",
              fromMe: false,
              remoteJid: "5551234567@s.whatsapp.net",
            },
            messageBody: "Hello!",
          },
        ],
      },
    };
    const resolved = await verifyWasenderApiWebhook({ payload });

    expect(resolved).toEqual({
      kind: "event",
      connectionId: "wasenderapi-connection-id",
      event: {
        externalEventId: "message-id-123",
        externalDeliveryId: "message-id-123",
        providerEventType: "messages.upsert",
        eventType: "wasenderapi.messages.upsert",
        payload,
        occurredAt: "2021-10-05T17:59:49.000Z",
        sourceOrderKey: "2021-10-05T17:59:49.000Z#message-id-123",
      },
    });
  });

  it("rejects unadvertised session status deliveries", async () => {
    const payload = {
      event: "session.status",
      sessionId: "wasender-session-id",
      data: {
        status: "connected",
      },
    };
    await expect(verifyWasenderApiWebhook({ payload })).rejects.toThrow(
      "WasenderAPI webhook event 'session.status' is not supported.",
    );
  });

  it("rejects deliveries without a matching signature header", async () => {
    await expect(
      verifyWasenderApiWebhook({
        signature: "wrong-secret",
        payload: {
          event: "messages.upsert",
        },
      }),
    ).rejects.toThrow("WasenderAPI webhook signature verification failed.");
  });
});
