import { describe, expect, it } from "vitest";

import { SlackThreadRootTimestampField } from "./normalized-event-fields.js";
import {
  SlackWebhookHandler,
  buildSlackWebhookSignature,
  verifySlackWebhookSignature,
} from "./webhook.server.js";

function createSlackMessageEvent(): Record<string, unknown> {
  return {
    type: "message",
    channel: "C123",
    user: "U123",
    text: "Hello from Slack",
    ts: "1710000000.000100",
    event_ts: "1710000000.000100",
  };
}

function createSlackMessagePayload(): Record<string, unknown> {
  return {
    token: "verification-token",
    team_id: "T123",
    api_app_id: "A123",
    event: createSlackMessageEvent(),
    type: "event_callback",
    event_id: "Ev123",
    event_time: 1_710_000_000,
    authed_users: ["U999"],
  };
}

describe("slack webhook handler", () => {
  it("resolves Slack URL verification requests as verified immediate responses", () => {
    const payload = {
      token: "verification-token",
      challenge: "challenge-value",
      type: "url_verification",
    };
    const rawBody = new TextEncoder().encode(JSON.stringify(payload));

    const resolved = SlackWebhookHandler.resolveWebhookRequest({
      targetKey: "slack-default",
      target: {
        familyId: "slack",
        variantId: "slack-default",
        enabled: true,
        config: {
          apiBaseUrl: "https://slack.com/api",
        },
        secrets: {},
      },
      headers: {},
      rawBody,
    });

    expect(resolved).toEqual({
      kind: "response",
      verification: "required",
      event: {
        externalEventId: "url_verification:challenge-value",
        providerEventType: "url_verification",
        eventType: "slack:url_verification",
        payload,
      },
      response: {
        status: 200,
        contentType: "text/plain",
        body: "challenge-value",
      },
    });
  });

  it("normalizes Slack message events", () => {
    const payload = createSlackMessagePayload();
    const rawBody = new TextEncoder().encode(JSON.stringify(payload));

    const resolved = SlackWebhookHandler.resolveWebhookRequest({
      targetKey: "slack-default",
      target: {
        familyId: "slack",
        variantId: "slack-default",
        enabled: true,
        config: {
          apiBaseUrl: "https://slack.com/api",
        },
        secrets: {},
      },
      headers: {},
      rawBody,
    });

    expect(resolved).toEqual({
      kind: "event",
      event: {
        externalEventId: "Ev123",
        providerEventType: "message",
        eventType: "slack:message",
        payload: {
          ...payload,
          event: {
            ...createSlackMessageEvent(),
            [SlackThreadRootTimestampField]: "1710000000.000100",
          },
        },
        occurredAt: "2024-03-09T16:00:00.000Z",
        sourceOrderKey: "2024-03-09T16:00:00.000Z#1710000000.000100",
      },
    });
  });

  it("normalizes Slack thread replies with a stable thread root timestamp", () => {
    const payload = {
      ...createSlackMessagePayload(),
      event: {
        ...createSlackMessageEvent(),
        ts: "1710000000.000200",
        event_ts: "1710000000.000200",
        thread_ts: "1710000000.000100",
      },
      event_id: "Ev123-thread",
    };
    const rawBody = new TextEncoder().encode(JSON.stringify(payload));

    const resolved = SlackWebhookHandler.resolveWebhookRequest({
      targetKey: "slack-default",
      target: {
        familyId: "slack",
        variantId: "slack-default",
        enabled: true,
        config: {
          apiBaseUrl: "https://slack.com/api",
        },
        secrets: {},
      },
      headers: {},
      rawBody,
    });

    expect(resolved).toEqual({
      kind: "event",
      event: {
        externalEventId: "Ev123-thread",
        providerEventType: "message",
        eventType: "slack:message",
        payload: {
          ...payload,
          event: {
            ...payload.event,
            [SlackThreadRootTimestampField]: "1710000000.000100",
          },
        },
        occurredAt: "2024-03-09T16:00:00.000Z",
        sourceOrderKey: "2024-03-09T16:00:00.000Z#1710000000.000200",
      },
    });
  });

  it("normalizes app mentions and reactions", () => {
    const appMentionPayload = {
      ...createSlackMessagePayload(),
      event: {
        type: "app_mention",
        channel: "C123",
        user: "U123",
        text: "<@A123> ping",
        ts: "1710000000.000200",
        event_ts: "1710000000.000200",
      },
      event_id: "Ev124",
    };
    const reactionPayload = {
      ...createSlackMessagePayload(),
      event: {
        type: "reaction_added",
        user: "U123",
        reaction: "thumbsup",
        item: {
          type: "message",
          channel: "C123",
          ts: "1710000000.000100",
        },
        event_ts: "1710000000.000300",
      },
      event_id: "Ev125",
    };

    expect(
      SlackWebhookHandler.resolveWebhookRequest({
        targetKey: "slack-default",
        target: {
          familyId: "slack",
          variantId: "slack-default",
          enabled: true,
          config: {
            apiBaseUrl: "https://slack.com/api",
          },
          secrets: {},
        },
        headers: {},
        rawBody: new TextEncoder().encode(JSON.stringify(appMentionPayload)),
      }),
    ).toEqual({
      kind: "event",
      event: {
        externalEventId: "Ev124",
        providerEventType: "app_mention",
        eventType: "slack:app_mention",
        payload: {
          ...appMentionPayload,
          event: {
            ...appMentionPayload.event,
            [SlackThreadRootTimestampField]: "1710000000.000200",
          },
        },
        occurredAt: "2024-03-09T16:00:00.000Z",
        sourceOrderKey: "2024-03-09T16:00:00.000Z#1710000000.000200",
      },
    });

    expect(
      SlackWebhookHandler.resolveWebhookRequest({
        targetKey: "slack-default",
        target: {
          familyId: "slack",
          variantId: "slack-default",
          enabled: true,
          config: {
            apiBaseUrl: "https://slack.com/api",
          },
          secrets: {},
        },
        headers: {},
        rawBody: new TextEncoder().encode(JSON.stringify(reactionPayload)),
      }),
    ).toEqual({
      kind: "event",
      event: {
        externalEventId: "Ev125",
        providerEventType: "reaction_added",
        eventType: "slack:reaction_added",
        payload: reactionPayload,
        occurredAt: "2024-03-09T16:00:00.000Z",
        sourceOrderKey: "2024-03-09T16:00:00.000Z#1710000000.000300",
      },
    });
  });

  it("normalizes Slack message subtypes away from slack:message", () => {
    const payload = {
      ...createSlackMessagePayload(),
      event: {
        ...createSlackMessageEvent(),
        hidden: true,
        subtype: "message_deleted",
        deleted_ts: "1710000000.000100",
        previous_message: {
          text: "Hello from Slack",
        },
      },
      event_id: "Ev126",
    };

    expect(
      SlackWebhookHandler.resolveWebhookRequest({
        targetKey: "slack-default",
        target: {
          familyId: "slack",
          variantId: "slack-default",
          enabled: true,
          config: {
            apiBaseUrl: "https://slack.com/api",
          },
          secrets: {},
        },
        headers: {},
        rawBody: new TextEncoder().encode(JSON.stringify(payload)),
      }),
    ).toEqual({
      kind: "event",
      event: {
        externalEventId: "Ev126",
        providerEventType: "message_deleted",
        eventType: "slack:message_deleted",
        payload,
        occurredAt: "2024-03-09T16:00:00.000Z",
        sourceOrderKey: "2024-03-09T16:00:00.000Z#1710000000.000100",
      },
    });
  });

  it("rejects unsupported Slack event types", () => {
    const rawBody = new TextEncoder().encode(
      JSON.stringify({
        ...createSlackMessagePayload(),
        event: {
          type: "channel_created",
        },
      }),
    );

    expect(() =>
      SlackWebhookHandler.resolveWebhookRequest({
        targetKey: "slack-default",
        target: {
          familyId: "slack",
          variantId: "slack-default",
          enabled: true,
          config: {
            apiBaseUrl: "https://slack.com/api",
          },
          secrets: {},
        },
        headers: {},
        rawBody,
      }),
    ).toThrow("Slack event type 'channel_created' is not supported.");
  });

  it("verifies valid Slack webhook signatures", () => {
    const rawBody = new TextEncoder().encode(JSON.stringify(createSlackMessagePayload()));
    const timestamp = Math.floor(Date.now() / 1000).toString();
    const signature = buildSlackWebhookSignature({
      signingSecret: "slack-signing-secret",
      timestamp,
      rawBody,
    });

    expect(
      SlackWebhookHandler.verify({
        targetKey: "slack-default",
        target: {
          familyId: "slack",
          variantId: "slack-default",
          enabled: true,
          config: {
            apiBaseUrl: "https://slack.com/api",
          },
          secrets: {},
        },
        event: {
          externalEventId: "Ev123",
          eventType: "slack:message",
          providerEventType: "message",
          payload: createSlackMessagePayload(),
        },
        connection: {
          id: "icn_slack",
          status: "active",
          config: {
            connection_method: "slack-bot-token",
          },
        },
        connectionSecrets: {
          signingSecret: "slack-signing-secret",
        },
        headers: {
          "x-slack-request-timestamp": timestamp,
          "x-slack-signature": signature,
        },
        rawBody,
      }),
    ).toEqual({
      ok: true,
    });
  });

  it("rejects invalid Slack webhook signatures", () => {
    const rawBody = new TextEncoder().encode(JSON.stringify(createSlackMessagePayload()));

    expect(
      verifySlackWebhookSignature({
        signingSecret: "slack-signing-secret",
        timestamp: "1710000000",
        signature: "v0=deadbeef",
        rawBody,
        nowMs: 1_710_000_000_000,
      }),
    ).toEqual({
      ok: false,
      code: "invalid-signature",
      message: "Slack signature did not match.",
    });
  });

  it("rejects stale Slack timestamps", () => {
    const rawBody = new TextEncoder().encode(JSON.stringify(createSlackMessagePayload()));

    expect(
      verifySlackWebhookSignature({
        signingSecret: "slack-signing-secret",
        timestamp: "1710000000",
        signature: buildSlackWebhookSignature({
          signingSecret: "slack-signing-secret",
          timestamp: "1710000000",
          rawBody,
        }),
        rawBody,
        nowMs: 1_710_000_301_000,
      }),
    ).toEqual({
      ok: false,
      code: "invalid-signature",
      message: "Slack request timestamp is outside the accepted tolerance window.",
    });
  });
});
