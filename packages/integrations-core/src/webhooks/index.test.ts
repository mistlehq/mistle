import { describe, expect, it } from "vitest";

import { IntegrationWebhookError, WebhookErrorCodes } from "../errors/index.js";
import type { IntegrationConnection, IntegrationWebhookHandler } from "../types/index.js";
import {
  getWebhookHandlerOrThrow,
  normalizeWebhookHeaders,
  verifyAndParseWebhookOrThrow,
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
}): IntegrationWebhookHandler {
  return {
    resolveConnection: () =>
      input?.resolveConnectionResult ?? {
        ok: true,
        connectionId: CandidateConnection.id,
      },
    verify: () => input?.verifyResult ?? { ok: true },
    parse: () => ({
      externalEventId: "evt_123",
      externalDeliveryId: "delivery_123",
      providerEventType: "issue_comment",
      eventType: input?.eventType ?? "github.issue_comment.created",
      payload: {
        hello: "world",
      },
    }),
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

  it("parses, resolves connection, and verifies webhook events", async () => {
    const resolvedWebhook = await verifyAndParseWebhookOrThrow({
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

    expect(resolvedWebhook.event.eventType).toBe("github.issue_comment.created");
    expect(resolvedWebhook.connectionId).toBe(CandidateConnection.id);
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
      verifyAndParseWebhookOrThrow({
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
      verifyAndParseWebhookOrThrow({
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
      verifyAndParseWebhookOrThrow({
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

    await verifyAndParseWebhookOrThrow({
      definition: {
        familyId: "github",
        variantId: "github-cloud",
        webhookHandler: {
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
          parse: () => ({
            externalEventId: "evt_123",
            externalDeliveryId: "delivery_123",
            providerEventType: "issue_comment",
            eventType: "github.issue_comment.created",
            payload: {},
          }),
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
});
