import { describe, expect, it } from "vitest";

import { IntegrationWebhookError, WebhookErrorCodes } from "../errors/index.js";
import type { IntegrationConnection, IntegrationWebhookHandler } from "../types/index.js";
import {
  getWebhookHandlerOrThrow,
  normalizeWebhookHeaders,
  verifyAndResolveWebhookRequestOrThrow,
} from "./index.js";

const CandidateConnection: IntegrationConnection = {
  id: "icn_123",
  status: "active",
  externalSubjectId: "subj_123",
  config: {},
};

function createWebhookHandler(input?: {
  resolveConnectionResult?:
    | { ok: true; connectionId: string }
    | { ok: false; code: "connection-not-found" | "connection-ambiguous"; message: string };
  verifyResult?: { ok: true } | { ok: false; code: "invalid-signature"; message: string };
  eventType?: string;
  resolveWebhookRequestResult?:
    | {
        kind: "event";
        event: {
          externalEventId: string;
          externalDeliveryId: string;
          providerEventType: string;
          eventType: string;
          payload: Record<string, unknown>;
        };
      }
    | {
        kind: "response";
        response: {
          status: number;
          contentType?: string;
          body?: string | Record<string, unknown>;
        };
      };
}): IntegrationWebhookHandler {
  return {
    resolveWebhookRequest: () =>
      input?.resolveWebhookRequestResult ?? {
        kind: "event",
        event: {
          externalEventId: "evt_123",
          externalDeliveryId: "delivery_123",
          providerEventType: "issue_comment",
          eventType: input?.eventType ?? "github.issue_comment.created",
          payload: {
            hello: "world",
          },
        },
      },
    resolveConnection: () =>
      input?.resolveConnectionResult ?? {
        ok: true,
        connectionId: CandidateConnection.id,
      },
    verify: () => input?.verifyResult ?? { ok: true },
  };
}

describe("webhook helpers", () => {
  it("normalizes webhook headers into lowercase keys", () => {
    const normalizedHeaders = normalizeWebhookHeaders({
      "X-Hub-Signature-256": "sha256=abc",
      "x-hub-signature-256": "sha256=def",
      "X-Webhook-Event": ["issue_comment", "pull_request_comment"],
      "X-Undefined": undefined,
    });

    expect(normalizedHeaders).toEqual({
      "x-hub-signature-256": "sha256=abc,sha256=def",
      "x-webhook-event": "issue_comment,pull_request_comment",
    });
  });

  it("returns webhook handler when configured", () => {
    const webhookHandler = createWebhookHandler();

    const resolvedHandler = getWebhookHandlerOrThrow({
      familyId: "github",
      variantId: "github-cloud",
      webhookHandler,
    });

    expect(resolvedHandler).toBe(webhookHandler);
  });

  it("throws when webhook handler is not configured", () => {
    expect(() =>
      getWebhookHandlerOrThrow({
        familyId: "openai",
        variantId: "openai-default",
      }),
    ).toThrow(IntegrationWebhookError);

    let caughtError: unknown;
    try {
      getWebhookHandlerOrThrow({
        familyId: "openai",
        variantId: "openai-default",
      });
    } catch (error) {
      caughtError = error;
    }

    expect(caughtError).toBeInstanceOf(IntegrationWebhookError);
    expect(caughtError).toMatchObject({
      code: WebhookErrorCodes.WEBHOOK_HANDLER_NOT_CONFIGURED,
    });
  });

  it("resolves, verifies, and returns webhook events", async () => {
    const resolvedWebhook = await verifyAndResolveWebhookRequestOrThrow({
      definition: {
        familyId: "github",
        variantId: "github-cloud",
        webhookHandler: createWebhookHandler(),
      },
      targetKey: "github_cloud",
      target: {
        familyId: "github",
        variantId: "github-cloud",
        enabled: true,
        config: {},
        secrets: {},
      },
      connections: [CandidateConnection],
      resolveConnectionSecrets: () => ({}),
      headers: {
        "x-event": "issue_comment",
      },
      rawBody: new TextEncoder().encode('{"ok":true}'),
    });

    expect(resolvedWebhook).toMatchObject({
      kind: "event",
      event: {
        eventType: "github.issue_comment.created",
      },
      connectionId: CandidateConnection.id,
    });
  });

  it("throws when webhook verification fails", async () => {
    await expect(
      verifyAndResolveWebhookRequestOrThrow({
        definition: {
          familyId: "github",
          variantId: "github-cloud",
          webhookHandler: createWebhookHandler({
            verifyResult: {
              ok: false,
              code: "invalid-signature",
              message: "invalid signature",
            },
          }),
        },
        targetKey: "github_cloud",
        target: {
          familyId: "github",
          variantId: "github-cloud",
          enabled: true,
          config: {},
          secrets: {},
        },
        connections: [CandidateConnection],
        resolveConnectionSecrets: () => ({}),
        headers: {},
        rawBody: new Uint8Array(),
      }),
    ).rejects.toBeInstanceOf(IntegrationWebhookError);
  });

  it("maps missing connection resolution to webhook connection-not-found error", async () => {
    await expect(
      verifyAndResolveWebhookRequestOrThrow({
        definition: {
          familyId: "github",
          variantId: "github-cloud",
          webhookHandler: createWebhookHandler({
            resolveConnectionResult: {
              ok: false,
              code: "connection-not-found",
              message: "No active connection matches webhook subject.",
            },
          }),
        },
        targetKey: "github_cloud",
        target: {
          familyId: "github",
          variantId: "github-cloud",
          enabled: true,
          config: {},
          secrets: {},
        },
        connections: [CandidateConnection],
        resolveConnectionSecrets: () => ({}),
        headers: {},
        rawBody: new Uint8Array(),
      }),
    ).rejects.toMatchObject({
      code: WebhookErrorCodes.WEBHOOK_CONNECTION_NOT_FOUND,
    });
  });

  it("maps ambiguous connection resolution to webhook connection-ambiguous error", async () => {
    await expect(
      verifyAndResolveWebhookRequestOrThrow({
        definition: {
          familyId: "github",
          variantId: "github-cloud",
          webhookHandler: createWebhookHandler({
            resolveConnectionResult: {
              ok: false,
              code: "connection-ambiguous",
              message: "Multiple connections match webhook subject.",
            },
          }),
        },
        targetKey: "github_cloud",
        target: {
          familyId: "github",
          variantId: "github-cloud",
          enabled: true,
          config: {},
          secrets: {},
        },
        connections: [CandidateConnection],
        resolveConnectionSecrets: () => ({}),
        headers: {},
        rawBody: new Uint8Array(),
      }),
    ).rejects.toMatchObject({
      code: WebhookErrorCodes.WEBHOOK_CONNECTION_AMBIGUOUS,
    });
  });

  it("fails when resolver returns a connection id that is not in candidates", async () => {
    await expect(
      verifyAndResolveWebhookRequestOrThrow({
        definition: {
          familyId: "github",
          variantId: "github-cloud",
          webhookHandler: createWebhookHandler({
            resolveConnectionResult: {
              ok: true,
              connectionId: "icn_unknown",
            },
          }),
        },
        targetKey: "github_cloud",
        target: {
          familyId: "github",
          variantId: "github-cloud",
          enabled: true,
          config: {},
          secrets: {},
        },
        connections: [CandidateConnection],
        resolveConnectionSecrets: () => ({}),
        headers: {},
        rawBody: new Uint8Array(),
      }),
    ).rejects.toMatchObject({
      code: WebhookErrorCodes.WEBHOOK_CONNECTION_RESOLUTION_FAILED,
    });
  });

  it("passes resolved connection and event into verify and secret resolver", async () => {
    let resolvedConnectionId: string | undefined;
    let verifyConnectionId: string | undefined;
    let verifyEventType: string | undefined;
    let verifyConnectionSecrets: Record<string, string> | undefined;

    await verifyAndResolveWebhookRequestOrThrow({
      definition: {
        familyId: "github",
        variantId: "github-cloud",
        webhookHandler: {
          resolveWebhookRequest: () => ({
            kind: "event",
            event: {
              externalEventId: "evt_123",
              externalDeliveryId: "delivery_123",
              providerEventType: "issue_comment",
              eventType: "github.issue_comment.created",
              payload: {},
            },
          }),
          resolveConnection: () => ({
            ok: true,
            connectionId: CandidateConnection.id,
          }),
          verify: (input) => {
            verifyConnectionId = input.connection.id;
            verifyEventType = input.event.eventType;
            verifyConnectionSecrets = input.connectionSecrets;
            return { ok: true };
          },
        },
      },
      targetKey: "github_cloud",
      target: {
        familyId: "github",
        variantId: "github-cloud",
        enabled: true,
        config: {},
        secrets: {},
      },
      connections: [CandidateConnection],
      resolveConnectionSecrets: ({ connectionId }) => {
        resolvedConnectionId = connectionId;
        return {
          webhook_secret: "whsec_123",
        };
      },
      headers: {},
      rawBody: new Uint8Array(),
    });

    expect(resolvedConnectionId).toBe(CandidateConnection.id);
    expect(verifyConnectionId).toBe(CandidateConnection.id);
    expect(verifyEventType).toBe("github.issue_comment.created");
    expect(verifyConnectionSecrets).toEqual({
      webhook_secret: "whsec_123",
    });
  });

  it("short-circuits with an immediate response", async () => {
    const resolvedWebhook = await verifyAndResolveWebhookRequestOrThrow({
      definition: {
        familyId: "slack",
        variantId: "slack-default",
        webhookHandler: createWebhookHandler({
          resolveWebhookRequestResult: {
            kind: "response",
            response: {
              status: 200,
              contentType: "text/plain",
              body: "challenge-value",
            },
          },
        }),
      },
      targetKey: "slack_default",
      target: {
        familyId: "slack",
        variantId: "slack-default",
        enabled: true,
        config: {},
        secrets: {},
      },
      connections: [CandidateConnection],
      resolveConnectionSecrets: () => {
        throw new Error("resolveConnectionSecrets should not be called for immediate responses");
      },
      headers: {},
      rawBody: new Uint8Array(),
    });

    expect(resolvedWebhook).toEqual({
      kind: "response",
      response: {
        status: 200,
        contentType: "text/plain",
        body: "challenge-value",
      },
    });
  });
});
