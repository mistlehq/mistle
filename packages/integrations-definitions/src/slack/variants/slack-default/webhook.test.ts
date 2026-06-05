import { createServer, type IncomingMessage, type ServerResponse } from "node:http";

import {
  createIntegrationWebhookRequestSnapshot,
  IntegrationWebhookError,
  runIntegrationWebhookMiddleware,
  type IntegrationWebhookMiddlewareBaseContext,
} from "@mistle/integrations-core";
import { systemSleeper } from "@mistle/time";
import { describe, expect, it } from "vitest";

import { SlackThreadRootTimestampField } from "./normalized-event-fields.js";
import {
  SlackWebhookHandler,
  SlackWebhookMiddlewares,
  buildSlackWebhookSignature,
  verifySlackWebhookSignature,
} from "./webhook.server.js";

async function startTestServer(input: {
  handler: (request: IncomingMessage, response: ServerResponse) => void;
}): Promise<{
  baseUrl: string;
  stop: () => Promise<void>;
}> {
  const server = createServer(input.handler);

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject);
      resolve();
    });
  });

  const address = server.address();
  if (address === null || typeof address === "string") {
    throw new Error("Expected HTTP server address.");
  }

  return {
    baseUrl: `http://127.0.0.1:${String(address.port)}`,
    stop: async () => {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error === undefined) {
            resolve();
            return;
          }

          reject(error);
        });
      });
    },
  };
}

async function readRequestBody(request: IncomingMessage): Promise<string> {
  const chunks: Uint8Array[] = [];
  for await (const chunk of request) {
    if (typeof chunk === "string") {
      chunks.push(new TextEncoder().encode(chunk));
      continue;
    }

    chunks.push(chunk);
  }

  return new TextDecoder().decode(Buffer.concat(chunks));
}

async function waitForCondition(input: {
  description: string;
  condition: () => boolean;
}): Promise<void> {
  const deadlineMs = Date.now() + 1_000;
  while (Date.now() < deadlineMs) {
    if (input.condition()) {
      return;
    }

    await systemSleeper.sleep(10);
  }

  throw new Error(`Timed out waiting for ${input.description}.`);
}

async function startSimulatedSlackApi(input: {
  handler: (request: IncomingMessage, response: ServerResponse) => void;
}): Promise<{
  baseUrl: string;
  stop: () => Promise<void>;
}> {
  return startTestServer(input);
}

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

function createSlackMiddlewareContext(input: {
  apiBaseUrl?: string;
  botToken?: string;
  headers: Record<string, string>;
  rawBody: Uint8Array;
  signingSecret: string;
}): IntegrationWebhookMiddlewareBaseContext {
  return {
    request: createIntegrationWebhookRequestSnapshot({
      targetKey: "slack-default",
      endpointKey: "iws_slack",
      headers: input.headers,
      rawBody: input.rawBody,
    }),
    organizationId: "org_slack",
    target: {
      targetKey: "slack-default",
      familyId: "slack",
      variantId: "slack-default",
      enabled: true,
      config: {
        apiBaseUrl: input.apiBaseUrl ?? "https://slack.com/api",
      },
      secrets: {},
    },
    connection: {
      id: "icn_slack",
      status: "active",
      config: {},
      secrets: {
        ...(input.botToken === undefined ? {} : { botToken: input.botToken }),
        signingSecret: input.signingSecret,
      },
    },
    webhookSource: {
      id: "iws_slack",
      endpointKey: "iws_slack",
      providerMetadata: {},
      secrets: {},
    },
  };
}

function createSlackUrlVerificationRequest(input: { challenge: string; signingSecret: string }): {
  headers: Record<string, string>;
  rawBody: Uint8Array;
} {
  const rawBody = new TextEncoder().encode(
    JSON.stringify({
      token: "verification-token",
      challenge: input.challenge,
      type: "url_verification",
    }),
  );
  const timestamp = Math.floor(Date.now() / 1000).toString();

  return {
    headers: {
      "x-slack-request-timestamp": timestamp,
      "x-slack-signature": buildSlackWebhookSignature({
        signingSecret: input.signingSecret,
        timestamp,
        rawBody,
      }),
    },
    rawBody,
  };
}

function createSlackEventRequest(input: {
  payload: Record<string, unknown>;
  signingSecret: string;
}): {
  headers: Record<string, string>;
  rawBody: Uint8Array;
} {
  const rawBody = new TextEncoder().encode(JSON.stringify(input.payload));
  const timestamp = Math.floor(Date.now() / 1000).toString();

  return {
    headers: {
      "x-slack-request-timestamp": timestamp,
      "x-slack-signature": buildSlackWebhookSignature({
        signingSecret: input.signingSecret,
        timestamp,
        rawBody,
      }),
    },
    rawBody,
  };
}

function createSlackBlockActionsRequest(input: {
  payload: Record<string, unknown>;
  signingSecret: string;
}): {
  headers: Record<string, string>;
  rawBody: Uint8Array;
} {
  const form = new URLSearchParams({
    payload: JSON.stringify(input.payload),
  });
  const rawBody = new TextEncoder().encode(form.toString());
  const timestamp = Math.floor(Date.now() / 1000).toString();

  return {
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      "x-slack-request-timestamp": timestamp,
      "x-slack-signature": buildSlackWebhookSignature({
        signingSecret: input.signingSecret,
        timestamp,
        rawBody,
      }),
    },
    rawBody,
  };
}

describe("slack webhook handler", () => {
  it("short-circuits Slack URL verification requests after signature verification", async () => {
    const request = createSlackUrlVerificationRequest({
      challenge: "challenge-value",
      signingSecret: "slack-signing-secret",
    });

    const resolved = await runIntegrationWebhookMiddleware({
      context: createSlackMiddlewareContext({
        headers: request.headers,
        rawBody: request.rawBody,
        signingSecret: "slack-signing-secret",
      }),
      middleware: SlackWebhookMiddlewares,
      next: async () => "core",
    });

    expect(resolved).toEqual({
      kind: "short-circuited",
      response: {
        status: 200,
        contentType: "text/plain",
        body: "challenge-value",
      },
    });
  });

  it("rejects Slack URL verification requests when signature verification fails", async () => {
    const request = createSlackUrlVerificationRequest({
      challenge: "challenge-value",
      signingSecret: "wrong-signing-secret",
    });

    await expect(
      runIntegrationWebhookMiddleware({
        context: createSlackMiddlewareContext({
          headers: request.headers,
          rawBody: request.rawBody,
          signingSecret: "slack-signing-secret",
        }),
        middleware: SlackWebhookMiddlewares,
        next: async () => "core",
      }),
    ).rejects.toThrow(IntegrationWebhookError);
  });

  it("short-circuits Slack block action requests after signature verification", async () => {
    const request = createSlackBlockActionsRequest({
      payload: {
        type: "block_actions",
        user: {
          id: "U123",
        },
        api_app_id: "A123",
        team: {
          id: "T123",
        },
        actions: [
          {
            action_id: "mistle_view_session",
            block_id: "mistle_session_link",
            type: "button",
            action_ts: "1729999330.000000",
          },
        ],
      },
      signingSecret: "slack-signing-secret",
    });

    const resolved = await runIntegrationWebhookMiddleware({
      context: createSlackMiddlewareContext({
        headers: request.headers,
        rawBody: request.rawBody,
        signingSecret: "slack-signing-secret",
      }),
      middleware: SlackWebhookMiddlewares,
      next: async () => "core",
    });

    expect(resolved).toEqual({
      kind: "short-circuited",
      response: {
        status: 200,
        contentType: "text/plain",
        body: "",
      },
    });
  });

  it("rejects Slack block action requests when signature verification fails", async () => {
    const request = createSlackBlockActionsRequest({
      payload: {
        type: "block_actions",
        actions: [
          {
            action_id: "mistle_view_session",
            block_id: "mistle_session_link",
            type: "button",
            action_ts: "1729999330.000000",
          },
        ],
      },
      signingSecret: "wrong-signing-secret",
    });

    await expect(
      runIntegrationWebhookMiddleware({
        context: createSlackMiddlewareContext({
          headers: request.headers,
          rawBody: request.rawBody,
          signingSecret: "slack-signing-secret",
        }),
        middleware: SlackWebhookMiddlewares,
        next: async () => "core",
      }),
    ).rejects.toThrow(IntegrationWebhookError);
  });

  it("continues Slack event callbacks after parsing the webhook payload", async () => {
    const rawBody = new TextEncoder().encode(JSON.stringify(createSlackMessagePayload()));

    const resolved = await runIntegrationWebhookMiddleware({
      context: createSlackMiddlewareContext({
        headers: {},
        rawBody,
        signingSecret: "slack-signing-secret",
      }),
      middleware: SlackWebhookMiddlewares,
      next: async () => "core",
    });

    expect(resolved).toEqual({
      kind: "continued",
      result: "core",
    });
  });

  it("sets Slack assistant status for app mentions", async () => {
    const seenRequests: Array<{
      authorization: string | null;
      body: unknown;
      contentType: string | null;
      method: string | undefined;
      url: string | undefined;
    }> = [];
    const server = await startSimulatedSlackApi({
      handler(request, response) {
        void (async () => {
          // Slack assistant.threads.setStatus accepts JSON with channel_id, thread_ts, status,
          // and loading_messages. See https://docs.slack.dev/reference/methods/assistant.threads.setStatus/
          seenRequests.push({
            authorization: request.headers.authorization ?? null,
            body: JSON.parse(await readRequestBody(request)),
            contentType: request.headers["content-type"] ?? null,
            method: request.method,
            url: request.url,
          });
          response.setHeader("content-type", "application/json");
          response.end(JSON.stringify({ ok: true }));
        })().catch((error: unknown) => {
          response.writeHead(500);
          response.end(error instanceof Error ? error.message : "Unexpected test server error.");
        });
      },
    });
    const payload = {
      ...createSlackMessagePayload(),
      event: {
        type: "app_mention",
        channel: "C123",
        user: "U123",
        text: "<@A123> can you help?",
        ts: "1729999330.000000",
        event_ts: "1729999330.000000",
      },
    };
    const request = createSlackEventRequest({
      payload,
      signingSecret: "slack-signing-secret",
    });

    try {
      const resolved = await runIntegrationWebhookMiddleware({
        context: createSlackMiddlewareContext({
          apiBaseUrl: `${server.baseUrl}/slack/api`,
          botToken: "xoxb-test-token",
          headers: request.headers,
          rawBody: request.rawBody,
          signingSecret: "slack-signing-secret",
        }),
        middleware: SlackWebhookMiddlewares,
        next: async () => "core",
      });

      expect(resolved).toEqual({
        kind: "continued",
        result: "core",
      });
      await waitForCondition({
        description: "Slack assistant status request",
        condition: () => seenRequests.length === 1,
      });
      expect(seenRequests).toEqual([
        {
          authorization: "Bearer xoxb-test-token",
          body: {
            channel_id: "C123",
            thread_ts: "1729999330.000000",
            status: "working...",
            loading_messages: [
              "Working through it...",
              "Keeping at it...",
              "Making progress...",
              "Still on it...",
              "On the case...",
            ],
          },
          contentType: "application/json",
          method: "POST",
          url: "/slack/api/assistant.threads.setStatus",
        },
      ]);
    } finally {
      await server.stop();
    }
  });

  it("continues when Slack assistant status cannot be set", async () => {
    const seenUrls: string[] = [];
    const server = await startSimulatedSlackApi({
      handler(request, response) {
        // Slack Web API error responses use HTTP 200 with ok: false and an error code.
        // See https://docs.slack.dev/reference/methods/assistant.threads.setStatus/
        seenUrls.push(request.url ?? "");
        response.setHeader("content-type", "application/json");
        response.end(JSON.stringify({ ok: false, error: "missing_scope" }));
      },
    });
    const payload = {
      ...createSlackMessagePayload(),
      event: {
        type: "app_mention",
        channel: "C123",
        user: "U123",
        text: "<@A123> can you help?",
        ts: "1729999330.000000",
        thread_ts: "1729999327.187299",
        event_ts: "1729999330.000000",
      },
    };
    const request = createSlackEventRequest({
      payload,
      signingSecret: "slack-signing-secret",
    });

    try {
      const resolved = await runIntegrationWebhookMiddleware({
        context: createSlackMiddlewareContext({
          apiBaseUrl: `${server.baseUrl}/slack/api`,
          botToken: "xoxb-test-token",
          headers: request.headers,
          rawBody: request.rawBody,
          signingSecret: "slack-signing-secret",
        }),
        middleware: SlackWebhookMiddlewares,
        next: async () => "core",
      });

      expect(resolved).toEqual({
        kind: "continued",
        result: "core",
      });
      await waitForCondition({
        description: "Slack assistant status request",
        condition: () => seenUrls.length === 1,
      });
      expect(seenUrls).toEqual(["/slack/api/assistant.threads.setStatus"]);
    } finally {
      await server.stop();
    }
  });

  it("continues before Slack assistant status completes", async () => {
    const seenUrls: string[] = [];
    let statusResponseSent = false;
    const server = await startSimulatedSlackApi({
      handler(request, response) {
        void (async () => {
          // Slack assistant.threads.setStatus is an optional Web API call for assistant UX.
          // See https://docs.slack.dev/reference/methods/assistant.threads.setStatus/
          seenUrls.push(request.url ?? "");
          await systemSleeper.sleep(100);
          response.setHeader("content-type", "application/json");
          response.end(JSON.stringify({ ok: true }));
          statusResponseSent = true;
        })().catch((error: unknown) => {
          response.writeHead(500);
          response.end(error instanceof Error ? error.message : "Unexpected test server error.");
        });
      },
    });
    const payload = {
      ...createSlackMessagePayload(),
      event: {
        type: "app_mention",
        channel: "C123",
        user: "U123",
        text: "<@A123> can you help?",
        ts: "1729999330.000000",
        event_ts: "1729999330.000000",
      },
    };
    const request = createSlackEventRequest({
      payload,
      signingSecret: "slack-signing-secret",
    });

    try {
      const resolved = await runIntegrationWebhookMiddleware({
        context: createSlackMiddlewareContext({
          apiBaseUrl: `${server.baseUrl}/slack/api`,
          botToken: "xoxb-test-token",
          headers: request.headers,
          rawBody: request.rawBody,
          signingSecret: "slack-signing-secret",
        }),
        middleware: SlackWebhookMiddlewares,
        next: async () => "core",
      });

      expect(resolved).toEqual({
        kind: "continued",
        result: "core",
      });
      expect(statusResponseSent).toBe(false);
      await waitForCondition({
        description: "Slack assistant status response",
        condition: () => statusResponseSent,
      });
      expect(seenUrls).toEqual(["/slack/api/assistant.threads.setStatus"]);
    } finally {
      await server.stop();
    }
  });

  it("does not set Slack assistant status for plain message events", async () => {
    const seenUrls: string[] = [];
    const server = await startSimulatedSlackApi({
      handler(request, response) {
        seenUrls.push(request.url ?? "");
        response.setHeader("content-type", "application/json");
        response.end(JSON.stringify({ ok: true }));
      },
    });
    const payload = {
      ...createSlackMessagePayload(),
      event: {
        type: "message",
        channel: "C123",
        user: "U123",
        text: "Can you help?",
        ts: "1729999330.000000",
        thread_ts: "1729999327.187299",
        event_ts: "1729999330.000000",
      },
    };
    const request = createSlackEventRequest({
      payload,
      signingSecret: "slack-signing-secret",
    });

    try {
      const resolved = await runIntegrationWebhookMiddleware({
        context: createSlackMiddlewareContext({
          apiBaseUrl: `${server.baseUrl}/slack/api`,
          botToken: "xoxb-test-token",
          headers: request.headers,
          rawBody: request.rawBody,
          signingSecret: "slack-signing-secret",
        }),
        middleware: SlackWebhookMiddlewares,
        next: async () => "core",
      });

      expect(resolved).toEqual({
        kind: "continued",
        result: "core",
      });
      expect(seenUrls).toEqual([]);
    } finally {
      await server.stop();
    }
  });

  it("rejects forged Slack assistant status requests before calling Slack", async () => {
    const seenUrls: string[] = [];
    const server = await startSimulatedSlackApi({
      handler(request, response) {
        seenUrls.push(request.url ?? "");
        response.setHeader("content-type", "application/json");
        response.end(JSON.stringify({ ok: true }));
      },
    });
    const payload = {
      ...createSlackMessagePayload(),
      event: {
        type: "app_mention",
        channel: "C123",
        user: "U123",
        text: "<@A123> can you help?",
        ts: "1729999330.000000",
        event_ts: "1729999330.000000",
      },
    };
    const request = createSlackEventRequest({
      payload,
      signingSecret: "wrong-signing-secret",
    });

    try {
      await expect(
        runIntegrationWebhookMiddleware({
          context: createSlackMiddlewareContext({
            apiBaseUrl: `${server.baseUrl}/slack/api`,
            botToken: "xoxb-test-token",
            headers: request.headers,
            rawBody: request.rawBody,
            signingSecret: "slack-signing-secret",
          }),
          middleware: SlackWebhookMiddlewares,
          next: async () => "core",
        }),
      ).rejects.toThrow(IntegrationWebhookError);
      expect(seenUrls).toEqual([]);
    } finally {
      await server.stop();
    }
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

  it("preserves Slack API base path prefixes when enriching reactions", async () => {
    const seenUrls: string[] = [];
    const server = await startTestServer({
      handler(request, response) {
        if (request.url === undefined) {
          response.writeHead(500);
          response.end("Missing request URL.");
          return;
        }

        const requestUrl = new URL(request.url, "http://127.0.0.1");
        seenUrls.push(requestUrl.toString());
        response.setHeader("content-type", "application/json");
        response.end(
          JSON.stringify({
            ok: true,
            messages: [
              {
                type: "message",
                channel: "C123",
                ts: "1710000000.000100",
                thread_ts: "1710000000.000050",
              },
            ],
          }),
        );
      },
    });

    try {
      if (SlackWebhookHandler.enrichEvent === undefined) {
        throw new Error("Expected Slack webhook handler to define event enrichment.");
      }

      const enriched = await SlackWebhookHandler.enrichEvent({
        targetKey: "slack-default",
        target: {
          familyId: "slack",
          variantId: "slack-default",
          enabled: true,
          config: {
            apiBaseUrl: `${server.baseUrl}/slack/api`,
          },
          secrets: {},
        },
        connection: {
          id: "icn_slack",
          status: "active",
          config: {
            connection_method: "slack-bot-token",
          },
        },
        event: {
          externalEventId: "Ev125",
          providerEventType: "reaction_added",
          eventType: "slack:reaction_added",
          payload: {
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
          },
        },
        connectionSecrets: {
          botToken: "xoxb-test-token",
        },
        webhookSourceSecrets: {},
        headers: {},
        rawBody: new Uint8Array(),
      });

      expect(seenUrls).toEqual([
        "http://127.0.0.1/slack/api/conversations.replies?channel=C123&ts=1710000000.000100",
      ]);
      expect(enriched.payload.event).toMatchObject({
        channel: "C123",
        [SlackThreadRootTimestampField]: "1710000000.000050",
      });
    } finally {
      await server.stop();
    }
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

  it("normalizes Slack channel lifecycle events for resource sync triggers", () => {
    const lifecyclePayloads = [
      {
        payload: {
          ...createSlackMessagePayload(),
          event: {
            type: "channel_created",
            channel: {
              id: "C123",
              name: "alerts",
              created: 1_710_000_000,
            },
          },
          event_id: "Ev127",
        },
        expectedEventType: "slack:channel_created",
      },
      {
        payload: {
          ...createSlackMessagePayload(),
          event: {
            type: "channel_archive",
            channel: "C123",
          },
          event_id: "Ev128",
        },
        expectedEventType: "slack:channel_archive",
      },
      {
        payload: {
          ...createSlackMessagePayload(),
          event: {
            type: "channel_unarchive",
            channel: "C123",
          },
          event_id: "Ev129",
        },
        expectedEventType: "slack:channel_unarchive",
      },
      {
        payload: {
          ...createSlackMessagePayload(),
          event: {
            type: "channel_rename",
            channel: {
              id: "C123",
              name: "alerts-renamed",
              created: 1_710_000_000,
            },
          },
          event_id: "Ev130",
        },
        expectedEventType: "slack:channel_rename",
      },
      {
        payload: {
          ...createSlackMessagePayload(),
          event: {
            type: "group_archive",
            channel: "G123",
          },
          event_id: "Ev131",
        },
        expectedEventType: "slack:group_archive",
      },
      {
        payload: {
          ...createSlackMessagePayload(),
          event: {
            type: "group_unarchive",
            channel: "G123",
          },
          event_id: "Ev132",
        },
        expectedEventType: "slack:group_unarchive",
      },
      {
        payload: {
          ...createSlackMessagePayload(),
          event: {
            type: "group_rename",
            channel: "G123",
            name: "secret-plans-renamed",
          },
          event_id: "Ev133",
        },
        expectedEventType: "slack:group_rename",
      },
    ] as const;

    for (const lifecyclePayload of lifecyclePayloads) {
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
          rawBody: new TextEncoder().encode(JSON.stringify(lifecyclePayload.payload)),
        }),
      ).toEqual({
        kind: "event",
        event: {
          externalEventId: lifecyclePayload.payload.event_id,
          providerEventType: lifecyclePayload.payload.event.type,
          eventType: lifecyclePayload.expectedEventType,
          payload: lifecyclePayload.payload,
          occurredAt: "2024-03-09T16:00:00.000Z",
        },
      });
    }
  });

  it("rejects unsupported Slack event types", () => {
    const rawBody = new TextEncoder().encode(
      JSON.stringify({
        ...createSlackMessagePayload(),
        event: {
          type: "team_join",
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
    ).toThrow("Slack event type 'team_join' is not supported.");
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
        webhookSourceSecrets: {},
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
