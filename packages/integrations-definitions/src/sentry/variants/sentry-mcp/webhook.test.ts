import { IntegrationWebhookSourceLifecycles } from "@mistle/integrations-core";
import { describe, expect, it } from "vitest";

import { SentrySupportedWebhookEvents } from "./supported-webhook-events.js";
import { SentryWebhookSourceCapability } from "./webhook-source.server.js";
import {
  buildSentryWebhookSignature,
  SentryWebhookHandler,
  verifySentryWebhookSignature,
} from "./webhook.server.js";

const SentryClientSecret = "sentry-client-secret";

const SampleSentryIssuePayload = {
  action: "created",
  installation: {
    uuid: "24b397fc-a86e-43ef-9297-949e21b82480",
  },
  data: {
    issue: {
      url: "https://sentry.io/api/0/organizations/example-org/issues/1234567890/",
      web_url: "https://example-org.sentry.io/issues/1234567890/",
      project_url: "https://example-org.sentry.io/issues/?project=4509877862268928",
      id: "1234567890",
      shortId: "PYTHON-Y",
      title: "Error generated with event_id: 495d375a",
      status: "unresolved",
      statusDetails: {},
      substatus: "new",
      project: {
        id: "112313123123134",
        name: "python",
        slug: "python",
        platform: "python",
      },
      issueType: "error",
      issueCategory: "error",
      priority: "high",
      lastSeen: "2025-11-10T20:56:00.738000+00:00",
    },
  },
  actor: {
    type: "application",
    id: "example-app",
    name: "Example App",
  },
} satisfies Record<string, unknown>;

function encodePayload(payload: Record<string, unknown>): Uint8Array {
  return new TextEncoder().encode(JSON.stringify(payload));
}

function createHeaders(input?: {
  includeRequestId?: boolean;
  resource?: string;
  signature?: string;
  requestId?: string;
}): Record<string, string> {
  const signature =
    input?.signature ??
    buildSentryWebhookSignature({
      clientSecret: SentryClientSecret,
      payload: SampleSentryIssuePayload,
    });

  const headers: Record<string, string> = {
    "content-type": "application/json",
    "sentry-hook-resource": input?.resource ?? "issue",
    "sentry-hook-timestamp": "2025-11-10T20:56:01.000000+00:00",
    "sentry-hook-signature": signature,
  };

  if (input?.includeRequestId !== false) {
    headers["request-id"] = input?.requestId ?? "request_123";
  }

  return headers;
}

describe("Sentry webhook support", () => {
  it("advertises documented Sentry issue actions as trigger events", () => {
    expect(SentrySupportedWebhookEvents.map((event) => event.eventType)).toEqual([
      "sentry.issue.created",
      "sentry.issue.resolved",
      "sentry.issue.assigned",
      "sentry.issue.archived",
      "sentry.issue.unresolved",
    ]);
    expect(SentrySupportedWebhookEvents.map((event) => event.providerEventType)).toEqual([
      "issue.created",
      "issue.resolved",
      "issue.assigned",
      "issue.archived",
      "issue.unresolved",
    ]);
  });

  it("describes an implicit Sentry issue webhook source for internal integrations", () => {
    expect(SentryWebhookSourceCapability.lifecycle).toBe(
      IntegrationWebhookSourceLifecycles.IMPLICIT,
    );
    expect(
      SentryWebhookSourceCapability.supportsConnection?.({
        connection: {
          id: "icn_sentry",
          status: "active",
          config: {
            connection_method: "sentry-internal-integration",
          },
        },
      }),
    ).toBe(true);
    expect(
      SentryWebhookSourceCapability.supportsConnection?.({
        connection: {
          id: "icn_sentry_oauth",
          status: "active",
          config: {
            connection_method: "oauth2-authorization-code",
            client_id: "sentry_oauth_client_123",
          },
        },
      }),
    ).toBe(false);

    expect(
      SentryWebhookSourceCapability.describeSource({
        organizationId: "org_123",
        targetKey: "sentry-mcp",
        controlPlaneBaseUrl: "https://control-plane.example.com",
        target: {
          familyId: "sentry",
          variantId: "sentry-mcp",
          enabled: true,
          config: {},
          secrets: {},
        },
        connection: {
          id: "icn_sentry",
          status: "active",
          config: {
            connection_method: "sentry-internal-integration",
          },
        },
        source: {
          id: "iws_sentry",
          targetKey: "sentry-mcp",
          organizationId: "org_123",
          integrationConnectionId: "icn_sentry",
          endpointKey: "eps_sentry",
          providerMetadata: {},
        },
      }),
    ).toEqual({
      displayName: "Sentry issue webhook",
      callbackUrl: "https://control-plane.example.com/p/integration/webhooks/sentry-mcp/eps_sentry",
      providerMetadata: {},
    });
  });

  it("normalizes a signed Sentry issue webhook into a trigger event", async () => {
    const result = await SentryWebhookHandler.resolveWebhookRequest({
      targetKey: "sentry-mcp",
      target: {
        familyId: "sentry",
        variantId: "sentry-mcp",
        enabled: true,
        config: {},
        secrets: {},
      },
      headers: createHeaders(),
      rawBody: encodePayload(SampleSentryIssuePayload),
    });

    expect(result).toEqual({
      kind: "event",
      event: {
        externalEventId: "issue.created:1234567890",
        externalDeliveryId: "request_123",
        providerEventType: "issue.created",
        eventType: "sentry.issue.created",
        payload: SampleSentryIssuePayload,
        occurredAt: "2025-11-10T20:56:00.738Z",
        sourceOrderKey: "2025-11-10T20:56:00.738Z#request_123",
      },
    });
  });

  it("rejects unsupported Sentry webhook resources and issue actions", () => {
    expect(() =>
      SentryWebhookHandler.resolveWebhookRequest({
        targetKey: "sentry-mcp",
        target: {
          familyId: "sentry",
          variantId: "sentry-mcp",
          enabled: true,
          config: {},
          secrets: {},
        },
        headers: createHeaders({ resource: "event_alert" }),
        rawBody: encodePayload(SampleSentryIssuePayload),
      }),
    ).toThrow("Sentry webhook resource 'event_alert' is not supported.");

    expect(() =>
      SentryWebhookHandler.resolveWebhookRequest({
        targetKey: "sentry-mcp",
        target: {
          familyId: "sentry",
          variantId: "sentry-mcp",
          enabled: true,
          config: {},
          secrets: {},
        },
        headers: createHeaders(),
        rawBody: encodePayload({
          ...SampleSentryIssuePayload,
          action: "deleted",
        }),
      }),
    ).toThrow("Sentry issue webhook action 'deleted' is not supported.");
  });

  it("requires documented delivery and issue identifiers", () => {
    expect(() =>
      SentryWebhookHandler.resolveWebhookRequest({
        targetKey: "sentry-mcp",
        target: {
          familyId: "sentry",
          variantId: "sentry-mcp",
          enabled: true,
          config: {},
          secrets: {},
        },
        headers: createHeaders({ includeRequestId: false }),
        rawBody: encodePayload(SampleSentryIssuePayload),
      }),
    ).toThrow("Sentry webhook is missing request-id header.");

    const { id: _removedIssueId, ...issueWithoutId } = SampleSentryIssuePayload.data.issue;

    expect(() =>
      SentryWebhookHandler.resolveWebhookRequest({
        targetKey: "sentry-mcp",
        target: {
          familyId: "sentry",
          variantId: "sentry-mcp",
          enabled: true,
          config: {},
          secrets: {},
        },
        headers: createHeaders(),
        rawBody: encodePayload({
          ...SampleSentryIssuePayload,
          data: {
            ...SampleSentryIssuePayload.data,
            issue: issueWithoutId,
          },
        }),
      }),
    ).toThrow("Sentry issue webhook payload is missing data.issue.id.");
  });

  it("verifies Sentry webhook signatures with the integration client secret", async () => {
    const signature = buildSentryWebhookSignature({
      clientSecret: SentryClientSecret,
      payload: SampleSentryIssuePayload,
    });

    expect(
      verifySentryWebhookSignature({
        clientSecret: SentryClientSecret,
        signature,
        payload: SampleSentryIssuePayload,
      }),
    ).toEqual({ ok: true });
    expect(
      verifySentryWebhookSignature({
        clientSecret: SentryClientSecret,
        signature: "not-hex",
        payload: SampleSentryIssuePayload,
      }),
    ).toEqual({
      ok: false,
      code: "invalid-signature",
      message: "Sentry signature header must be hex-encoded.",
    });
    expect(
      verifySentryWebhookSignature({
        clientSecret: "wrong-secret",
        signature,
        payload: SampleSentryIssuePayload,
      }),
    ).toEqual({
      ok: false,
      code: "invalid-signature",
      message: "Sentry webhook signature verification failed.",
    });

    const result = await SentryWebhookHandler.resolveWebhookRequest({
      targetKey: "sentry-mcp",
      target: {
        familyId: "sentry",
        variantId: "sentry-mcp",
        enabled: true,
        config: {},
        secrets: {},
      },
      headers: createHeaders({ signature }),
      rawBody: encodePayload(SampleSentryIssuePayload),
    });
    if (result.kind !== "event") {
      throw new Error("Expected Sentry issue webhook to resolve to an event.");
    }

    expect(
      SentryWebhookHandler.verify({
        targetKey: "sentry-mcp",
        target: {
          familyId: "sentry",
          variantId: "sentry-mcp",
          enabled: true,
          config: {},
          secrets: {},
        },
        event: result.event,
        connection: {
          id: "icn_sentry",
          status: "active",
          config: {
            connection_method: "sentry-internal-integration",
          },
        },
        connectionSecrets: {
          clientSecret: SentryClientSecret,
        },
        webhookSourceSecrets: {},
        headers: createHeaders({ signature }),
        rawBody: encodePayload(SampleSentryIssuePayload),
      }),
    ).toEqual({ ok: true });
  });

  it("requires a Sentry client secret and signature header before accepting webhooks", async () => {
    const result = await SentryWebhookHandler.resolveWebhookRequest({
      targetKey: "sentry-mcp",
      target: {
        familyId: "sentry",
        variantId: "sentry-mcp",
        enabled: true,
        config: {},
        secrets: {},
      },
      headers: createHeaders(),
      rawBody: encodePayload(SampleSentryIssuePayload),
    });
    if (result.kind !== "event") {
      throw new Error("Expected Sentry issue webhook to resolve to an event.");
    }

    expect(
      SentryWebhookHandler.verify({
        targetKey: "sentry-mcp",
        target: {
          familyId: "sentry",
          variantId: "sentry-mcp",
          enabled: true,
          config: {},
          secrets: {},
        },
        event: result.event,
        connection: {
          id: "icn_sentry",
          status: "active",
          config: {
            connection_method: "sentry-internal-integration",
          },
        },
        connectionSecrets: {},
        webhookSourceSecrets: {},
        headers: createHeaders(),
        rawBody: encodePayload(SampleSentryIssuePayload),
      }),
    ).toEqual({
      ok: false,
      code: "invalid-body",
      message: "Sentry webhook client secret is missing for this connection.",
    });

    expect(
      SentryWebhookHandler.verify({
        targetKey: "sentry-mcp",
        target: {
          familyId: "sentry",
          variantId: "sentry-mcp",
          enabled: true,
          config: {},
          secrets: {},
        },
        event: result.event,
        connection: {
          id: "icn_sentry",
          status: "active",
          config: {
            connection_method: "sentry-internal-integration",
          },
        },
        connectionSecrets: {
          clientSecret: SentryClientSecret,
        },
        webhookSourceSecrets: {},
        headers: {
          "content-type": "application/json",
          "request-id": "request_123",
          "sentry-hook-resource": "issue",
        },
        rawBody: encodePayload(SampleSentryIssuePayload),
      }),
    ).toEqual({
      ok: false,
      code: "invalid-headers",
      message: "Sentry webhook is missing sentry-hook-signature header.",
    });
  });
});
