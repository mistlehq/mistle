import { createHash, createHmac, createPublicKey, generateKeyPairSync, sign } from "node:crypto";

import { describe, expect, it } from "vitest";

import { DiscordDefinition } from "./definition.js";
import {
  DiscordWebhookHandler,
  verifyDiscordGatewayRelaySignature,
  verifyDiscordWebhookSignature,
} from "./webhook.server.js";

function exportRawEd25519PublicKeyHex(publicKey: ReturnType<typeof createPublicKey>): string {
  const der = publicKey.export({ format: "der", type: "spki" });
  return Buffer.from(der).subarray(-32).toString("hex");
}

function createSignedDiscordRequest(input: { body: string }) {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const timestamp = "1700000000";
  const signature = sign(
    null,
    Buffer.concat([Buffer.from(timestamp), Buffer.from(input.body)]),
    privateKey,
  );

  return {
    publicKey: exportRawEd25519PublicKeyHex(publicKey),
    signature: signature.toString("hex"),
    timestamp,
    rawBody: new TextEncoder().encode(input.body),
  };
}

describe("Discord webhook signature verification", () => {
  it("accepts Discord Ed25519 signatures over timestamp plus raw body", () => {
    const signedRequest = createSignedDiscordRequest({
      body: JSON.stringify({ type: 1 }),
    });

    expect(verifyDiscordWebhookSignature(signedRequest)).toEqual({ ok: true });
  });

  it("rejects signatures when the body changes", () => {
    const signedRequest = createSignedDiscordRequest({
      body: JSON.stringify({ type: 1 }),
    });

    expect(
      verifyDiscordWebhookSignature({
        ...signedRequest,
        rawBody: new TextEncoder().encode(JSON.stringify({ type: 2 })),
      }),
    ).toEqual({
      ok: false,
      code: "invalid-signature",
      message: "Discord webhook signature verification failed.",
    });
  });
});

describe("Discord Gateway relay signature verification", () => {
  it("accepts HMAC signatures over timestamp plus raw body", () => {
    const rawBody = new TextEncoder().encode(
      JSON.stringify({ op: 0, t: "MESSAGE_CREATE", d: { id: "message_123" } }),
    );
    const timestamp = "1700000000";
    const signature = createHmac("sha256", "discord-bot-token")
      .update(Buffer.concat([Buffer.from(timestamp), Buffer.from(rawBody)]))
      .digest("hex");

    expect(
      verifyDiscordGatewayRelaySignature({
        botToken: "discord-bot-token",
        signature,
        timestamp,
        rawBody,
      }),
    ).toEqual({ ok: true });
  });

  it("rejects HMAC signatures when the body changes", () => {
    const rawBody = new TextEncoder().encode(
      JSON.stringify({ op: 0, t: "MESSAGE_CREATE", d: { id: "message_123" } }),
    );
    const timestamp = "1700000000";
    const signature = createHmac("sha256", "discord-bot-token")
      .update(Buffer.concat([Buffer.from(timestamp), Buffer.from(rawBody)]))
      .digest("hex");

    expect(
      verifyDiscordGatewayRelaySignature({
        botToken: "discord-bot-token",
        signature,
        timestamp,
        rawBody: new TextEncoder().encode(
          JSON.stringify({ op: 0, t: "MESSAGE_CREATE", d: { id: "message_456" } }),
        ),
      }),
    ).toEqual({
      ok: false,
      code: "invalid-signature",
      message: "Discord Gateway relay signature verification failed.",
    });
  });
});

describe("DiscordWebhookHandler", () => {
  it("accepts persisted Discord webhook events with a 204 empty response", () => {
    expect(DiscordDefinition.webhookAcceptedResponse).toEqual({
      status: 204,
    });
  });

  it("responds to Discord interaction pings with pong", () => {
    const rawBody = new TextEncoder().encode(JSON.stringify({ id: "interaction_123", type: 1 }));

    expect(
      DiscordWebhookHandler.resolveWebhookRequest({
        targetKey: "discord-default",
        target: {
          familyId: "discord",
          variantId: "discord-default",
          enabled: true,
          config: {
            apiBaseUrl: "https://discord.com/api/v10",
          },
          secrets: {},
        },
        headers: {},
        rawBody,
      }),
    ).toEqual({
      kind: "response",
      verification: "required",
      event: {
        externalEventId: "interaction_123",
        externalDeliveryId: "interaction_123",
        providerEventType: "interaction_ping",
        eventType: "discord:interaction_ping",
        payload: {
          id: "interaction_123",
          type: 1,
        },
        sourceOrderKey: "interaction_123",
      },
      response: {
        status: 200,
        body: {
          type: 1,
        },
      },
    });
  });

  it("responds to Discord interaction callbacks with a deferred response while recording the event", () => {
    const rawBody = new TextEncoder().encode(
      JSON.stringify({
        id: "interaction_456",
        type: 2,
        guild_id: "guild_123",
        channel_id: "channel_123",
      }),
    );

    expect(
      DiscordWebhookHandler.resolveWebhookRequest({
        targetKey: "discord-default",
        target: {
          familyId: "discord",
          variantId: "discord-default",
          enabled: true,
          config: {
            apiBaseUrl: "https://discord.com/api/v10",
          },
          secrets: {},
        },
        headers: {},
        rawBody,
      }),
    ).toEqual({
      kind: "response",
      verification: "required",
      event: {
        externalEventId: "interaction_456",
        externalDeliveryId: "interaction_456",
        providerEventType: "interaction",
        eventType: "discord:interaction",
        payload: {
          id: "interaction_456",
          type: 2,
          guild_id: "guild_123",
          channel_id: "channel_123",
        },
        sourceOrderKey: "interaction_456",
      },
      response: {
        status: 200,
        body: {
          type: 5,
        },
      },
    });
  });

  it("normalizes Discord Webhook Event envelopes using the inner event type", () => {
    const rawBody = new TextEncoder().encode(
      JSON.stringify({
        type: 1,
        event: {
          type: "APPLICATION_AUTHORIZED",
          timestamp: "2026-06-26T12:00:00.000Z",
          data: {
            application_id: "app_123",
            user: {
              id: "user_123",
            },
          },
        },
      }),
    );
    const deliveryId = `application_authorized:${createHash("sha256").update(rawBody).digest("hex")}`;

    expect(
      DiscordWebhookHandler.resolveWebhookRequest({
        targetKey: "discord-default",
        target: {
          familyId: "discord",
          variantId: "discord-default",
          enabled: true,
          config: {
            apiBaseUrl: "https://discord.com/api/v10",
          },
          secrets: {},
        },
        headers: {},
        rawBody,
      }),
    ).toEqual({
      kind: "event",
      event: {
        externalEventId: deliveryId,
        externalDeliveryId: deliveryId,
        providerEventType: "application_authorized",
        eventType: "discord:application_authorized",
        occurredAt: "2026-06-26T12:00:00.000Z",
        payload: {
          type: 1,
          event: {
            type: "APPLICATION_AUTHORIZED",
            timestamp: "2026-06-26T12:00:00.000Z",
            data: {
              application_id: "app_123",
              user: {
                id: "user_123",
              },
            },
          },
        },
        sourceOrderKey: `2026-06-26T12:00:00.000Z#${deliveryId}`,
      },
    });
  });

  it("normalizes Discord Gateway dispatch payloads to webhook events", () => {
    const rawBody = new TextEncoder().encode(
      JSON.stringify({
        op: 0,
        s: 42,
        t: "MESSAGE_CREATE",
        d: {
          id: "message_123",
          channel_id: "channel_123",
          guild_id: "guild_123",
          content: "hello",
          timestamp: "2026-06-26T12:00:00.000Z",
        },
      }),
    );

    expect(
      DiscordWebhookHandler.resolveWebhookRequest({
        targetKey: "discord-default",
        target: {
          familyId: "discord",
          variantId: "discord-default",
          enabled: true,
          config: {
            apiBaseUrl: "https://discord.com/api/v10",
          },
          secrets: {},
        },
        headers: {},
        rawBody,
      }),
    ).toEqual({
      kind: "event",
      event: {
        externalEventId: "MESSAGE_CREATE:42:message_123",
        externalDeliveryId: "MESSAGE_CREATE:42:message_123",
        providerEventType: "MESSAGE_CREATE",
        eventType: "discord:message_create",
        occurredAt: "2026-06-26T12:00:00.000Z",
        payload: {
          op: 0,
          s: 42,
          t: "MESSAGE_CREATE",
          d: {
            id: "message_123",
            channel_id: "channel_123",
            guild_id: "guild_123",
            content: "hello",
            timestamp: "2026-06-26T12:00:00.000Z",
          },
        },
        sourceOrderKey: "2026-06-26T12:00:00.000Z#MESSAGE_CREATE:42:message_123",
      },
    });
  });

  it("keeps repeated Discord Gateway message updates distinct by sequence", async () => {
    const firstUpdate = new TextEncoder().encode(
      JSON.stringify({
        op: 0,
        s: 42,
        t: "MESSAGE_UPDATE",
        d: {
          id: "message_123",
          channel_id: "channel_123",
          guild_id: "guild_123",
          content: "first edit",
        },
      }),
    );
    const secondUpdate = new TextEncoder().encode(
      JSON.stringify({
        op: 0,
        s: 43,
        t: "MESSAGE_UPDATE",
        d: {
          id: "message_123",
          channel_id: "channel_123",
          guild_id: "guild_123",
          content: "second edit",
        },
      }),
    );

    const firstResolved = await DiscordWebhookHandler.resolveWebhookRequest({
      targetKey: "discord-default",
      target: {
        familyId: "discord",
        variantId: "discord-default",
        enabled: true,
        config: {
          apiBaseUrl: "https://discord.com/api/v10",
        },
        secrets: {},
      },
      headers: {},
      rawBody: firstUpdate,
    });
    const secondResolved = await DiscordWebhookHandler.resolveWebhookRequest({
      targetKey: "discord-default",
      target: {
        familyId: "discord",
        variantId: "discord-default",
        enabled: true,
        config: {
          apiBaseUrl: "https://discord.com/api/v10",
        },
        secrets: {},
      },
      headers: {},
      rawBody: secondUpdate,
    });

    if (firstResolved.kind !== "event") {
      throw new Error("Expected first Discord message update to resolve to an event.");
    }
    if (secondResolved.kind !== "event") {
      throw new Error("Expected second Discord message update to resolve to an event.");
    }

    expect(firstResolved.event.externalEventId).toBe("MESSAGE_UPDATE:42:message_123");
    expect(secondResolved.event.externalEventId).toBe("MESSAGE_UPDATE:43:message_123");
  });

  it("verifies Gateway relay requests with bot-token HMAC headers", () => {
    const rawBody = new TextEncoder().encode(
      JSON.stringify({ op: 0, t: "MESSAGE_CREATE", d: { id: "message_123" } }),
    );
    const timestamp = "1700000000";
    const signature = createHmac("sha256", "discord-bot-token")
      .update(Buffer.concat([Buffer.from(timestamp), Buffer.from(rawBody)]))
      .digest("hex");

    expect(
      DiscordWebhookHandler.verify({
        targetKey: "discord-default",
        target: {
          familyId: "discord",
          variantId: "discord-default",
          enabled: true,
          config: {
            apiBaseUrl: "https://discord.com/api/v10",
          },
          secrets: {},
        },
        connection: {
          id: "icn_discord",
          status: "active",
          config: {
            connection_method: "discord-bot",
          },
        },
        event: {
          externalEventId: "MESSAGE_CREATE:message_123",
          externalDeliveryId: "MESSAGE_CREATE:message_123",
          providerEventType: "MESSAGE_CREATE",
          eventType: "discord:message_create",
          payload: {},
          sourceOrderKey: "MESSAGE_CREATE:message_123",
        },
        connectionSecrets: {
          botToken: "discord-bot-token",
          publicKey: "0".repeat(64),
        },
        webhookSourceSecrets: {},
        headers: {
          "x-mistle-discord-gateway-signature": signature,
          "x-mistle-discord-gateway-timestamp": timestamp,
        },
        rawBody,
      }),
    ).toEqual({ ok: true });
  });

  it("rejects Gateway relay signatures for Discord Webhook Events", () => {
    const rawBody = new TextEncoder().encode(
      JSON.stringify({
        type: 1,
        event: {
          type: "APPLICATION_AUTHORIZED",
          timestamp: "2026-06-26T12:00:00.000Z",
        },
      }),
    );
    const timestamp = "1700000000";
    const signature = createHmac("sha256", "discord-bot-token")
      .update(Buffer.concat([Buffer.from(timestamp), Buffer.from(rawBody)]))
      .digest("hex");

    expect(
      DiscordWebhookHandler.verify({
        targetKey: "discord-default",
        target: {
          familyId: "discord",
          variantId: "discord-default",
          enabled: true,
          config: {
            apiBaseUrl: "https://discord.com/api/v10",
          },
          secrets: {},
        },
        connection: {
          id: "icn_discord",
          status: "active",
          config: {
            connection_method: "discord-bot",
          },
        },
        event: {
          externalEventId: "application_authorized:event_123",
          externalDeliveryId: "application_authorized:event_123",
          providerEventType: "application_authorized",
          eventType: "discord:application_authorized",
          payload: {},
          sourceOrderKey: "application_authorized:event_123",
        },
        connectionSecrets: {
          botToken: "discord-bot-token",
          publicKey: "0".repeat(64),
        },
        webhookSourceSecrets: {},
        headers: {
          "x-mistle-discord-gateway-signature": signature,
          "x-mistle-discord-gateway-timestamp": timestamp,
        },
        rawBody,
      }),
    ).toEqual({
      ok: false,
      code: "invalid-headers",
      message: "Discord Gateway relay signatures can only verify Gateway dispatch events.",
    });
  });
});
