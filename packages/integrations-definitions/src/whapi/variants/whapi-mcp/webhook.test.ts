import { TextEncoder } from "node:util";

import { verifyAndResolveWebhookRequestOrThrow } from "@mistle/integrations-core";
import { describe, expect, it } from "vitest";

import { WhapiDefinition } from "./definition.js";

function encodeJson(input: Record<string, unknown>): Uint8Array {
  return new TextEncoder().encode(JSON.stringify(input));
}

function verifyWhapiWebhook(input: { payload: Record<string, unknown> }) {
  return verifyAndResolveWebhookRequestOrThrow({
    definition: WhapiDefinition,
    targetKey: "whapi-mcp",
    target: {
      familyId: "whapi",
      variantId: "whapi-mcp",
      enabled: true,
      config: {},
      secrets: {},
    },
    connections: [
      {
        id: "whapi-connection-id",
        status: "active",
        config: {
          connection_method: "api-key",
        },
      },
    ],
    resolveConnectionSecrets: () => ({
      apiToken: "whapi-api-token",
    }),
    webhookSourceSecrets: {},
    headers: {},
    rawBody: encodeJson(input.payload),
  });
}

describe("WhapiWebhookHandler", () => {
  it("normalizes documented incoming message deliveries", async () => {
    const payload = {
      messages: [
        {
          id: "p.w30M7fgwWD4XwHu.g4CA-gBgTwl0rVw",
          from_me: false,
          type: "text",
          chat_id: "1234567890@s.whatsapp.net",
          timestamp: 1_712_995_245,
          source: "mobile",
          text: {
            body: "Hello world",
          },
          from: "919984351847",
          from_name: "Gerald",
        },
      ],
      event: {
        type: "messages",
        event: "post",
      },
      channel_id: "MANTIS-M72HC",
    };
    const resolved = await verifyWhapiWebhook({ payload });

    expect(resolved).toEqual({
      kind: "event",
      connectionId: "whapi-connection-id",
      event: {
        externalEventId: expect.stringMatching(
          /^messages\.post:p\.w30M7fgwWD4XwHu\.g4CA-gBgTwl0rVw:[0-9a-f]{64}$/,
        ),
        externalDeliveryId: expect.stringMatching(
          /^messages\.post:p\.w30M7fgwWD4XwHu\.g4CA-gBgTwl0rVw:[0-9a-f]{64}$/,
        ),
        providerEventType: "messages.post",
        eventType: "whapi.messages.post",
        payload,
        occurredAt: "2024-04-13T08:00:45.000Z",
        sourceOrderKey: expect.stringMatching(
          /^2024-04-13T08:00:45\.000Z#messages\.post:p\.w30M7fgwWD4XwHu\.g4CA-gBgTwl0rVw:[0-9a-f]{64}$/,
        ),
      },
    });
  });

  it("uses distinct delivery identifiers for message creates and updates on the same message", async () => {
    const message = {
      id: "p.w30M7fgwWD4XwHu.g4CA-gBgTwl0rVw",
      from_me: false,
      type: "text",
      chat_id: "1234567890@s.whatsapp.net",
      timestamp: 1_712_995_245,
    };
    const createdPayload = {
      messages: [message],
      event: {
        type: "messages",
        event: "post",
      },
      channel_id: "MANTIS-M72HC",
    };
    const updatedPayload = {
      messages: [message],
      event: {
        type: "messages",
        event: "put",
      },
      channel_id: "MANTIS-M72HC",
    };

    const createdResolved = await verifyWhapiWebhook({ payload: createdPayload });
    const updatedResolved = await verifyWhapiWebhook({ payload: updatedPayload });
    if (createdResolved.kind !== "event" || updatedResolved.kind !== "event") {
      throw new Error("Expected Whapi message deliveries to resolve to webhook events.");
    }

    expect(createdResolved.event.externalEventId).toMatch(
      /^messages\.post:p\.w30M7fgwWD4XwHu\.g4CA-gBgTwl0rVw:[0-9a-f]{64}$/,
    );
    expect(updatedResolved.event.externalEventId).toMatch(
      /^messages\.put:p\.w30M7fgwWD4XwHu\.g4CA-gBgTwl0rVw:[0-9a-f]{64}$/,
    );
    expect(createdResolved.event.externalEventId).not.toEqual(
      updatedResolved.event.externalEventId,
    );
  });

  it("normalizes documented poll vote message patch deliveries", async () => {
    const payload = {
      messages: [
        {
          id: "p.poll_message_id",
          from_me: true,
          type: "poll",
          chat_id: "1234567890@s.whatsapp.net",
          timestamp: 1_712_995_260,
          poll: {
            title: "Which slot works best?",
            results: [
              {
                name: "Morning",
                total: 2,
                count: 2,
                voters: ["1234567890@s.whatsapp.net", "15551234567@s.whatsapp.net"],
              },
              {
                name: "Afternoon",
                total: 1,
                count: 1,
                voters: ["14155550100@s.whatsapp.net"],
              },
            ],
          },
        },
      ],
      event: {
        type: "messages",
        event: "patch",
      },
      channel_id: "MANTIS-M72HC",
    };
    const resolved = await verifyWhapiWebhook({ payload });

    expect(resolved).toEqual({
      kind: "event",
      connectionId: "whapi-connection-id",
      event: {
        externalEventId: expect.stringMatching(/^messages\.patch:p\.poll_message_id:[0-9a-f]{64}$/),
        externalDeliveryId: expect.stringMatching(
          /^messages\.patch:p\.poll_message_id:[0-9a-f]{64}$/,
        ),
        providerEventType: "messages.patch",
        eventType: "whapi.messages.patch",
        payload,
        occurredAt: "2024-04-13T08:01:00.000Z",
        sourceOrderKey: expect.stringMatching(
          /^2024-04-13T08:01:00\.000Z#messages\.patch:p\.poll_message_id:[0-9a-f]{64}$/,
        ),
      },
    });
  });

  it("normalizes documented status deliveries", async () => {
    const payload = {
      statuses: [
        {
          id: "p.w30M7fgwWD4XwHu.g4CA-gBgTwl0rVw",
          code: 4,
          status: "read",
          recipient_id: "1234567890@s.whatsapp.net",
          timestamp: "1712995290",
        },
      ],
      event: {
        type: "statuses",
        event: "post",
      },
      channel_id: "MANTIS-M72HC",
    };
    const resolved = await verifyWhapiWebhook({ payload });

    expect(resolved).toEqual({
      kind: "event",
      connectionId: "whapi-connection-id",
      event: {
        externalEventId: expect.stringMatching(
          /^statuses\.post:p\.w30M7fgwWD4XwHu\.g4CA-gBgTwl0rVw:[0-9a-f]{64}$/,
        ),
        externalDeliveryId: expect.stringMatching(
          /^statuses\.post:p\.w30M7fgwWD4XwHu\.g4CA-gBgTwl0rVw:[0-9a-f]{64}$/,
        ),
        providerEventType: "statuses.post",
        eventType: "whapi.statuses.post",
        payload,
        occurredAt: "2024-04-13T08:01:30.000Z",
        sourceOrderKey: expect.stringMatching(
          /^2024-04-13T08:01:30\.000Z#statuses\.post:p\.w30M7fgwWD4XwHu\.g4CA-gBgTwl0rVw:[0-9a-f]{64}$/,
        ),
      },
    });
  });

  it("uses distinct delivery identifiers for repeated status callbacks on the same message", async () => {
    const statusId = "p.w30M7fgwWD4XwHu.g4CA-gBgTwl0rVw";
    const deliveredPayload = {
      statuses: [
        {
          id: statusId,
          code: 3,
          status: "delivered",
          recipient_id: "1234567890@s.whatsapp.net",
          timestamp: "1712995275",
        },
      ],
      event: {
        type: "statuses",
        event: "post",
      },
      channel_id: "MANTIS-M72HC",
    };
    const readPayload = {
      statuses: [
        {
          id: statusId,
          code: 4,
          status: "read",
          recipient_id: "1234567890@s.whatsapp.net",
          timestamp: "1712995290",
        },
      ],
      event: {
        type: "statuses",
        event: "post",
      },
      channel_id: "MANTIS-M72HC",
    };

    const deliveredResolved = await verifyWhapiWebhook({ payload: deliveredPayload });
    const readResolved = await verifyWhapiWebhook({ payload: readPayload });
    if (deliveredResolved.kind !== "event" || readResolved.kind !== "event") {
      throw new Error("Expected Whapi status deliveries to resolve to webhook events.");
    }

    expect(deliveredResolved.event.externalEventId).toMatch(
      /^statuses\.post:p\.w30M7fgwWD4XwHu\.g4CA-gBgTwl0rVw:[0-9a-f]{64}$/,
    );
    expect(readResolved.event.externalEventId).toMatch(
      /^statuses\.post:p\.w30M7fgwWD4XwHu\.g4CA-gBgTwl0rVw:[0-9a-f]{64}$/,
    );
    expect(deliveredResolved.event.externalEventId).not.toEqual(readResolved.event.externalEventId);
    expect(deliveredResolved.event.externalEventId).toEqual(
      deliveredResolved.event.externalDeliveryId,
    );
    expect(readResolved.event.externalEventId).toEqual(readResolved.event.externalDeliveryId);
  });

  it("uses distinct delivery identifiers for channel status updates on the same channel", async () => {
    const firstPayload = {
      health: {
        start_at: 1_713_774_883,
        uptime: 1,
        status: {
          code: 1,
          text: "INIT",
        },
        version: "1.8.3-74-gf7df472",
      },
      event: {
        type: "channel",
        event: "post",
      },
      channel_id: "MANTIS-M72HC",
    };
    const secondPayload = {
      health: {
        start_at: 1_713_774_883,
        uptime: 77,
        status: {
          code: 2,
          text: "LAUNCH",
        },
        version: "1.8.3-74-gf7df472",
      },
      event: {
        type: "channel",
        event: "post",
      },
      channel_id: "MANTIS-M72HC",
    };

    const firstResolved = await verifyWhapiWebhook({ payload: firstPayload });
    const secondResolved = await verifyWhapiWebhook({ payload: secondPayload });
    if (firstResolved.kind !== "event" || secondResolved.kind !== "event") {
      throw new Error("Expected Whapi channel updates to resolve to webhook events.");
    }

    expect(firstResolved.event.externalEventId).toMatch(/^channel\.post:[0-9a-f]{64}$/);
    expect(secondResolved.event.externalEventId).toMatch(/^channel\.post:[0-9a-f]{64}$/);
    expect(firstResolved.event.externalEventId).not.toEqual(secondResolved.event.externalEventId);
    expect(firstResolved.event.externalEventId).toEqual(firstResolved.event.externalDeliveryId);
    expect(secondResolved.event.externalEventId).toEqual(secondResolved.event.externalDeliveryId);
    expect(firstResolved.event.occurredAt).toEqual("2024-04-22T08:34:43.000Z");
    expect(secondResolved.event.occurredAt).toEqual("2024-04-22T08:34:43.000Z");
  });

  it("normalizes documented user connection deliveries", async () => {
    const payload = {
      user: {
        id: "1234567890",
        name: "Support Agent",
      },
      event: {
        type: "users",
        event: "post",
      },
      channel_id: "MANTIS-M72HC",
    };
    const resolved = await verifyWhapiWebhook({ payload });

    expect(resolved).toEqual({
      kind: "event",
      connectionId: "whapi-connection-id",
      event: {
        externalEventId: expect.stringMatching(/^users\.post:[0-9a-f]{64}$/),
        externalDeliveryId: expect.stringMatching(/^users\.post:[0-9a-f]{64}$/),
        providerEventType: "users.post",
        eventType: "whapi.users.post",
        payload,
        sourceOrderKey: expect.stringMatching(/^users\.post:[0-9a-f]{64}$/),
      },
    });
  });

  it("rejects unadvertised webhook event types", async () => {
    const payload = {
      labels: [],
      event: {
        type: "labels",
        event: "post",
      },
      channel_id: "MANTIS-M72HC",
    };
    await expect(verifyWhapiWebhook({ payload })).rejects.toThrow(
      "Whapi webhook event 'labels.post' is not supported.",
    );
  });

  it("accepts deliveries without a custom callback header", async () => {
    await expect(
      verifyWhapiWebhook({
        payload: {
          messages: [],
          event: {
            type: "messages",
            event: "post",
          },
        },
      }),
    ).resolves.toMatchObject({
      connectionId: "whapi-connection-id",
      event: {
        providerEventType: "messages.post",
      },
    });
  });
});
