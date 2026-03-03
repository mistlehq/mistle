import { describe, expect, it } from "vitest";

import { IntegrationWebhookError, WebhookErrorCodes } from "../errors/index.js";
import type { IntegrationWebhookHandler } from "../types/index.js";
import {
  assertWebhookConnectionRefOrThrow,
  getWebhookHandlerOrThrow,
  normalizeWebhookHeaders,
  verifyAndParseWebhookOrThrow,
} from "./index.js";

function createWebhookHandler(input?: {
  verifyResult?: { ok: true } | { ok: false; code: "invalid-signature"; message: string };
  eventType?: string;
  targetKey?: string;
}): IntegrationWebhookHandler {
  return {
    verify: () => input?.verifyResult ?? { ok: true },
    parse: ({ targetKey }) => ({
      externalEventId: "evt_123",
      externalDeliveryId: "delivery_123",
      providerEventType: "issue_comment",
      eventType: input?.eventType ?? "github.issue_comment.created",
      payload: {
        hello: "world",
      },
      connectionRef: {
        targetKey: input?.targetKey ?? targetKey,
        externalSubjectId: "subj_123",
      },
    }),
    supportedEventTypes: ["github.issue_comment.created"],
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
    ).toThrowError(IntegrationWebhookError);

    try {
      getWebhookHandlerOrThrow({
        familyId: "openai",
        variantId: "openai-default",
      });
    } catch (error) {
      expect(error).toBeInstanceOf(IntegrationWebhookError);
      if (error instanceof IntegrationWebhookError) {
        expect(error.code).toBe(WebhookErrorCodes.WEBHOOK_HANDLER_NOT_CONFIGURED);
      }
    }
  });

  it("verifies and parses webhook events", async () => {
    const webhookEvent = await verifyAndParseWebhookOrThrow({
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
      },
      headers: {
        "x-event": "issue_comment",
      },
      rawBody: new TextEncoder().encode('{"ok":true}'),
    });

    expect(webhookEvent.eventType).toBe("github.issue_comment.created");
    expect(webhookEvent.connectionRef.targetKey).toBe("github_cloud");
  });

  it("throws when webhook verification fails", async () => {
    await expect(
      verifyAndParseWebhookOrThrow({
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
        },
        headers: {},
        rawBody: new Uint8Array(),
      }),
    ).rejects.toBeInstanceOf(IntegrationWebhookError);
  });

  it("throws when parsed webhook event type is not supported", async () => {
    await expect(
      verifyAndParseWebhookOrThrow({
        definition: {
          familyId: "github",
          variantId: "github-cloud",
          webhookHandler: createWebhookHandler({
            eventType: "github.pull_request.closed",
          }),
        },
        targetKey: "github_cloud",
        target: {
          familyId: "github",
          variantId: "github-cloud",
          enabled: true,
          config: {},
        },
        headers: {},
        rawBody: new Uint8Array(),
      }),
    ).rejects.toMatchObject({
      code: WebhookErrorCodes.WEBHOOK_UNSUPPORTED_EVENT_TYPE,
    });
  });

  it("throws when connectionRef targetKey does not match route targetKey", () => {
    expect(() =>
      assertWebhookConnectionRefOrThrow({
        routeTargetKey: "github_cloud",
        connectionRef: {
          targetKey: "github_enterprise",
          externalSubjectId: "subj_123",
        },
      }),
    ).toThrowError(IntegrationWebhookError);
  });
});
