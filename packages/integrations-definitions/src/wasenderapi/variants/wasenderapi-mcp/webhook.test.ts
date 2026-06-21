import { TextEncoder } from "node:util";

import { verifyAndResolveWebhookRequestOrThrow } from "@mistle/integrations-core";
import { describe, expect, it } from "vitest";

import { WasenderApiDefinition } from "./definition.js";
import { WasenderApiWebhookEventMetadata } from "./supported-webhook-events.js";
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
  it("advertises all documented WasenderAPI webhook events with source documentation", () => {
    expect(
      WasenderApiWebhookEventMetadata.map((metadata) => ({
        providerEventType: metadata.providerEventType,
        docsUrl: metadata.docsUrl,
      })),
    ).toEqual([
      {
        providerEventType: "messages.received",
        docsUrl: "https://wasenderapi.com/api-docs/webhooks/webhook-message-received",
      },
      {
        providerEventType: "messages.upsert",
        docsUrl: "https://wasenderapi.com/api-docs/webhooks/webhook-message-upsert",
      },
      {
        providerEventType: "messages-personal.received",
        docsUrl: "https://www.wasenderapi.com/api-docs/webhooks/webhook-personal-message-received",
      },
      {
        providerEventType: "messages-group.received",
        docsUrl: "https://wasenderapi.com/api-docs/webhooks/webhook-group-message-received",
      },
      {
        providerEventType: "messages-newsletter.received",
        docsUrl:
          "https://www.wasenderapi.com/api-docs/webhooks/webhook-newsletter-message-received",
      },
      {
        providerEventType: "message.sent",
        docsUrl: "https://wasenderapi.com/api-docs/webhooks/webhook-message-sent",
      },
      {
        providerEventType: "messages.update",
        docsUrl: "https://wasenderapi.com/api-docs/webhooks/webhook-message-update",
      },
      {
        providerEventType: "messages.delete",
        docsUrl: "https://wasenderapi.com/api-docs/webhooks/webhook-message-deleted",
      },
      {
        providerEventType: "message-receipt.update",
        docsUrl: "https://wasenderapi.com/api-docs/webhooks/webhook-message-receipt-update",
      },
      {
        providerEventType: "messages.reaction",
        docsUrl: "https://wasenderapi.com/api-docs/webhooks/webhook-message-reaction",
      },
      {
        providerEventType: "call",
        docsUrl: "https://www.wasenderapi.com/api-docs/webhooks/webhook-call-received",
      },
      {
        providerEventType: "session.status",
        docsUrl: "https://wasenderapi.com/api-docs/webhooks/webhook-session-status",
      },
      {
        providerEventType: "qrcode.updated",
        docsUrl: "https://wasenderapi.com/api-docs/webhooks/webhook-qrcode-updated",
      },
      {
        providerEventType: "chats.upsert",
        docsUrl: "https://www.wasenderapi.com/api-docs/webhooks/webhook-chat-upsert",
      },
      {
        providerEventType: "chats.update",
        docsUrl: "https://wasenderapi.com/api-docs/webhooks/webhook-chat-update",
      },
      {
        providerEventType: "chats.delete",
        docsUrl: "https://www.wasenderapi.com/api-docs/webhooks/webhook-chat-delete",
      },
      {
        providerEventType: "groups.upsert",
        docsUrl: "https://www.wasenderapi.com/api-docs/webhooks/webhook-group-upsert",
      },
      {
        providerEventType: "groups.update",
        docsUrl: "https://wasenderapi.com/api-docs/webhooks/webhook-group-update",
      },
      {
        providerEventType: "group-participants.update",
        docsUrl: "https://www.wasenderapi.com/api-docs/webhooks/webhook-group-participants-update",
      },
      {
        providerEventType: "contacts.upsert",
        docsUrl: "https://www.wasenderapi.com/api-docs/webhooks/webhook-contact-upsert",
      },
      {
        providerEventType: "contacts.update",
        docsUrl: "https://www.wasenderapi.com/api-docs/webhooks/webhook-contact-update",
      },
      {
        providerEventType: "poll.results",
        docsUrl: "https://www.wasenderapi.com/api-docs/webhooks/webhook-poll-results",
      },
    ]);
  });

  it("normalizes every documented WasenderAPI webhook event into a Trigger event", async () => {
    await Promise.all(
      WasenderApiWebhookEventMetadata.map(async (metadata) => {
        const payload = createDocumentedWasenderApiPayload(metadata.providerEventType);
        const resolved = await verifyWasenderApiWebhook({ payload });

        if (resolved.kind !== "event") {
          throw new Error(`Expected '${metadata.providerEventType}' to resolve to an event.`);
        }

        expect(resolved.connectionId).toBe("wasenderapi-connection-id");
        expect(resolved.event.providerEventType).toBe(metadata.providerEventType);
        expect(resolved.event.eventType).toBe(`wasenderapi.${metadata.providerEventType}`);
        expect(resolved.event.payload).toEqual(payload);
        expect(resolved.event.externalEventId.trim().length).toBeGreaterThan(0);
        expect((resolved.event.externalDeliveryId ?? "").trim().length).toBeGreaterThan(0);
        expect(resolved.event.sourceOrderKey?.trim().length).toBeGreaterThan(0);
      }),
    );
  });

  it("returns a verified response for WasenderAPI webhook test deliveries", async () => {
    const payload = {
      event: "webhook.test",
      id: "wasender-webhook-test-id",
    };
    const resolved = await verifyWasenderApiWebhook({ payload });

    expect(resolved).toEqual({
      kind: "response",
      response: {
        status: 200,
        body: {
          received: true,
        },
      },
    });
  });

  it("rejects WasenderAPI webhook test deliveries without a matching signature header", async () => {
    await expect(
      verifyWasenderApiWebhook({
        signature: "wrong-secret",
        payload: {
          event: "webhook.test",
          id: "wasender-webhook-test-id",
        },
      }),
    ).rejects.toThrow("WasenderAPI webhook signature verification failed.");
  });

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

  it("uses the delivery id as the source order key when WasenderAPI omits a timestamp", async () => {
    const payload = {
      event: "messages.received",
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
        sourceOrderKey: "3EB0X123456789",
      },
    });
  });

  it("rejects unadvertised provider event deliveries", async () => {
    const payload = {
      event: "message.received",
      timestamp: 1_633_456_789,
      data: {
        id: "unsupported-message-event",
      },
    };
    await expect(verifyWasenderApiWebhook({ payload })).rejects.toThrow(
      "WasenderAPI webhook event 'message.received' is not supported.",
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

function createDocumentedWasenderApiPayload(providerEventType: string): Record<string, unknown> {
  switch (providerEventType) {
    case "messages.received":
    case "messages-personal.received":
      return createWasenderApiMessagePayload(providerEventType, "message-id-personal-123");
    case "messages-group.received":
      return {
        event: providerEventType,
        timestamp: 1_633_456_799,
        data: {
          messages: {
            key: {
              id: "message-id-group-456",
              fromMe: false,
              remoteJid: "123456789-987654321@g.us",
              participant: "123456789@lid",
            },
            messageBody: "Hey everyone, just checking in!",
          },
        },
      };
    case "messages-newsletter.received":
      return createWasenderApiMessagePayload(providerEventType, "message-id-newsletter-456");
    case "messages.upsert":
      return {
        event: providerEventType,
        timestamp: 1_633_456_789,
        data: {
          messages: [
            {
              key: {
                id: "message-id-upsert-123",
                fromMe: false,
                remoteJid: "5551234567@s.whatsapp.net",
              },
              messageBody: "Hello!",
            },
          ],
        },
      };
    case "message.sent":
      return {
        event: providerEventType,
        timestamp: 1_633_456_790,
        data: {
          key: {
            id: "message-id-sent-456",
            fromMe: true,
            remoteJid: "1987654321@s.whatsapp.net",
          },
          message: {
            conversation: "This is my reply.",
          },
          success: true,
        },
      };
    case "messages.update":
      return {
        event: providerEventType,
        timestamp: 1_747_775_431_467,
        data: {
          update: {
            status: 2,
          },
          key: {
            remoteJid: "1234567890@s.whatsapp.net",
            id: "message-id-status-123",
            fromMe: false,
          },
        },
      };
    case "messages.delete":
      return {
        event: providerEventType,
        timestamp: 1_633_456_800,
        data: {
          keys: [
            {
              id: "message-id-delete-789",
              fromMe: false,
              remoteJid: "1234567890@s.whatsapp.net",
            },
          ],
        },
      };
    case "message-receipt.update":
      return {
        event: providerEventType,
        sessionId: "wasender-session-id",
        timestamp: 1_234_567_890_123,
        data: {
          message: {
            key: {
              remoteJid: "1234567890@g.us",
              id: "message-id-receipt-123",
              fromMe: true,
              participant: "participant_jid_here",
            },
            receipt: {
              userJid: "participant_jid_here",
              receiptTimestamp: 1_234_567_890,
            },
          },
        },
      };
    case "messages.reaction":
      return {
        event: providerEventType,
        timestamp: 1_633_456_810,
        data: [
          {
            key: {
              id: "message-id-reaction-123",
              fromMe: false,
              remoteJid: "1234567890@s.whatsapp.net",
            },
            reaction: {
              text: "+1",
              key: {
                id: "message-id-reaction-123",
                fromMe: false,
                remoteJid: "1234567890@s.whatsapp.net",
              },
            },
          },
        ],
      };
    case "call":
      return {
        event: providerEventType,
        timestamp: 1_633_456_811,
        data: {
          id: "call-id-123",
          from: "1234567890@s.whatsapp.net",
          isVideo: false,
        },
      };
    case "session.status":
      return {
        event: providerEventType,
        sessionId: "wasender-session-id",
        data: {
          status: "connected",
        },
      };
    case "qrcode.updated":
      return {
        event: providerEventType,
        sessionId: "wasender-session-id",
        data: {
          qr: "2@67576ghf/RMXr8A2IP3/...",
        },
      };
    case "chats.upsert":
      return createWasenderApiArrayPayload(providerEventType, { id: "chat-id-123" });
    case "chats.update":
      return createWasenderApiArrayPayload(providerEventType, { id: "chat-id-456" });
    case "chats.delete":
      return {
        event: providerEventType,
        timestamp: 1_633_456_789,
        data: ["chat-id-789"],
      };
    case "groups.upsert":
      return createWasenderApiArrayPayload(providerEventType, { jid: "1234567890@g.us" });
    case "groups.update":
      return createWasenderApiArrayPayload(providerEventType, { jid: "0987654321@g.us" });
    case "group-participants.update":
      return {
        event: providerEventType,
        timestamp: 1_633_456_789,
        data: {
          jid: "1234567890@g.us",
          participants: ["1234567890"],
          action: "add",
        },
      };
    case "contacts.upsert":
      return createWasenderApiArrayPayload(providerEventType, { jid: "1234567890" });
    case "contacts.update":
      return createWasenderApiArrayPayload(providerEventType, { jid: "0987654321" });
    case "poll.results":
      return {
        event: providerEventType,
        sessionId: "wasender-session-id",
        timestamp: 1_753_278_982_097,
        data: {
          key: {
            remoteJid: "1234567890@s.whatsapp.net",
            fromMe: true,
            id: "poll-message-id-123",
          },
          pollResult: [
            {
              name: "Pizza",
              voters: ["1234567890@s.whatsapp.net"],
            },
          ],
        },
      };
    default:
      throw new Error(`Missing documented WasenderAPI payload for '${providerEventType}'.`);
  }
}

function createWasenderApiMessagePayload(
  providerEventType: string,
  messageId: string,
): Record<string, unknown> {
  return {
    event: providerEventType,
    timestamp: 1_633_456_789,
    data: {
      messages: {
        key: {
          id: messageId,
          fromMe: false,
          remoteJid: "1234567890@s.whatsapp.net",
        },
        messageBody: "Hello, I have a question",
      },
    },
  };
}

function createWasenderApiArrayPayload(
  providerEventType: string,
  resource: Record<string, unknown>,
): Record<string, unknown> {
  return {
    event: providerEventType,
    timestamp: 1_633_456_789,
    data: [resource],
  };
}
