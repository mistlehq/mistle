import { TextEncoder } from "node:util";

import { verifyAndResolveWebhookRequestOrThrow } from "@mistle/integrations-core";
import { describe, expect, it } from "vitest";

import { LinearBaseDefinition } from "./base-definition.js";
import {
  buildLinearWebhookSignature,
  LinearWebhookHandler,
  verifyLinearWebhookSignature,
} from "./webhook.server.js";

const WebhookSecret = "linear-webhook-secret";
const DeliveryId = "234d1a4e-b617-4388-90fe-adc3633d6b72";

function encodeJson(input: Record<string, unknown>): Uint8Array {
  return new TextEncoder().encode(JSON.stringify(input));
}

function createIssuePayload(input?: {
  webhookTimestamp?: number;
  updatedFrom?: Record<string, unknown>;
  data?: Record<string, unknown>;
}): Record<string, unknown> {
  return {
    action: "update",
    actor: {
      id: "actor-linear-user-id",
      type: "user",
      name: "Linear Orbit",
    },
    createdAt: "2026-05-24T12:53:18.084Z",
    data: {
      id: "issue-linear-id",
      identifier: "ENG-123",
      teamId: "linear-team-id",
      assigneeId: "current-linear-user-id",
      ...input?.data,
    },
    type: "Issue",
    updatedFrom: {
      assigneeId: "previous-linear-user-id",
      title: "Old title",
      ...input?.updatedFrom,
    },
    url: "https://linear.app/company/issue/ENG-123/test",
    organizationId: "linear-organization-id",
    webhookTimestamp: input?.webhookTimestamp ?? 1_779_625_998_084,
    webhookId: "linear-webhook-id",
  };
}

function createPayload(input: {
  type: string;
  action: string;
  webhookTimestamp?: number;
  updatedFrom?: Record<string, unknown>;
  data?: Record<string, unknown>;
}): Record<string, unknown> {
  return {
    action: input.action,
    actor: {
      id: "actor-linear-user-id",
      type: "user",
      name: "Linear Orbit",
    },
    createdAt: "2026-05-24T12:53:18.084Z",
    data: {
      id: `${input.type.toLowerCase()}-linear-id`,
      ...input.data,
    },
    type: input.type,
    updatedFrom: {
      name: "Previous name",
      ...input.updatedFrom,
    },
    url: `https://linear.app/company/${input.type.toLowerCase()}`,
    organizationId: "linear-organization-id",
    webhookTimestamp: input.webhookTimestamp ?? 1_779_625_998_084,
    webhookId: "linear-webhook-id",
  };
}

describe("Linear webhook signature helpers", () => {
  it("verifies the raw-body HMAC and current webhook timestamp", () => {
    const payload = createIssuePayload();
    const rawBody = encodeJson(payload);
    const signature = buildLinearWebhookSignature({
      webhookSecret: WebhookSecret,
      rawBody,
    });

    expect(
      verifyLinearWebhookSignature({
        webhookSecret: WebhookSecret,
        signature,
        rawBody,
        payload,
        nowMs: 1_779_626_000_000,
      }),
    ).toEqual({ ok: true });
  });

  it("rejects stale webhook timestamps after the signature matches", () => {
    const payload = createIssuePayload({
      webhookTimestamp: 1_779_500_000_000,
    });
    const rawBody = encodeJson(payload);
    const signature = buildLinearWebhookSignature({
      webhookSecret: WebhookSecret,
      rawBody,
    });

    expect(
      verifyLinearWebhookSignature({
        webhookSecret: WebhookSecret,
        signature,
        rawBody,
        payload,
        nowMs: 1_779_626_000_000,
      }),
    ).toEqual({
      ok: false,
      code: "invalid-signature",
      message: "Linear webhook timestamp is outside the accepted tolerance window.",
    });
  });

  it("rejects malformed hex signatures", () => {
    const payload = createIssuePayload();

    expect(
      verifyLinearWebhookSignature({
        webhookSecret: WebhookSecret,
        signature: "not-hex",
        rawBody: encodeJson(payload),
        payload,
        nowMs: 1_779_626_000_000,
      }),
    ).toEqual({
      ok: false,
      code: "invalid-signature",
      message: "Linear signature header must be hex-encoded.",
    });
  });
});

describe("LinearWebhookHandler", () => {
  it("normalizes and enriches issue update deliveries for trigger processing", async () => {
    const payload = createIssuePayload({
      webhookTimestamp: Date.now(),
    });
    const rawBody = encodeJson(payload);
    const signature = buildLinearWebhookSignature({
      webhookSecret: WebhookSecret,
      rawBody,
    });
    const resolved = await verifyAndResolveWebhookRequestOrThrow({
      definition: {
        ...LinearBaseDefinition,
        webhookHandler: LinearWebhookHandler,
      },
      targetKey: "linear-default",
      target: {
        familyId: "linear",
        variantId: "linear-default",
        enabled: true,
        config: {},
        secrets: {},
      },
      connections: [
        {
          id: "linear-connection-id",
          status: "active",
          config: {
            connection_method: "api-key",
          },
        },
      ],
      resolveConnectionSecrets: () => ({
        apiKey: "linear-api-key",
      }),
      webhookSourceSecrets: {
        webhookSecret: WebhookSecret,
      },
      headers: {
        "linear-delivery": DeliveryId,
        "linear-event": "Issue",
        "linear-signature": signature,
      },
      rawBody,
    });

    expect(resolved).toEqual({
      kind: "event",
      connectionId: "linear-connection-id",
      event: {
        externalEventId: DeliveryId,
        externalDeliveryId: DeliveryId,
        providerEventType: "Issue",
        eventType: "linear.issue.updated",
        payload: {
          ...payload,
          mistle: {
            changedFields: ["assigneeId", "title"],
            assignment: {
              changed: true,
              previousUserId: "previous-linear-user-id",
              currentUserId: "current-linear-user-id",
            },
          },
        },
        occurredAt: "2026-05-24T12:53:18.084Z",
        sourceOrderKey: `2026-05-24T12:53:18.084Z#linear-webhook-id:${DeliveryId}`,
      },
    });
  });

  it.each([
    {
      providerResourceType: "IssueLabel",
      providerAction: "create",
      eventType: "linear.issue_label.created",
    },
    {
      providerResourceType: "IssueLabel",
      providerAction: "update",
      eventType: "linear.issue_label.updated",
    },
    {
      providerResourceType: "IssueLabel",
      providerAction: "remove",
      eventType: "linear.issue_label.removed",
    },
    {
      providerResourceType: "Project",
      providerAction: "create",
      eventType: "linear.project.created",
    },
    {
      providerResourceType: "Project",
      providerAction: "update",
      eventType: "linear.project.updated",
    },
    {
      providerResourceType: "Project",
      providerAction: "remove",
      eventType: "linear.project.removed",
    },
    {
      providerResourceType: "Cycle",
      providerAction: "create",
      eventType: "linear.cycle.created",
    },
    {
      providerResourceType: "Cycle",
      providerAction: "update",
      eventType: "linear.cycle.updated",
    },
    {
      providerResourceType: "Cycle",
      providerAction: "remove",
      eventType: "linear.cycle.removed",
    },
    {
      providerResourceType: "Reaction",
      providerAction: "create",
      eventType: "linear.reaction.created",
    },
    {
      providerResourceType: "Reaction",
      providerAction: "update",
      eventType: "linear.reaction.updated",
    },
    {
      providerResourceType: "Reaction",
      providerAction: "remove",
      eventType: "linear.reaction.removed",
    },
  ])(
    "normalizes $providerResourceType $providerAction deliveries for trigger processing",
    ({ providerResourceType, providerAction, eventType }) => {
      const payload = createPayload({
        type: providerResourceType,
        action: providerAction,
      });

      const resolved = LinearWebhookHandler.resolveWebhookRequest({
        targetKey: "linear-default",
        target: {
          familyId: "linear",
          variantId: "linear-default",
          enabled: true,
          config: {},
          secrets: {},
        },
        headers: {
          "linear-delivery": DeliveryId,
          "linear-event": providerResourceType,
        },
        rawBody: encodeJson(payload),
      });

      expect(resolved).toEqual({
        kind: "event",
        event: {
          externalEventId: DeliveryId,
          externalDeliveryId: DeliveryId,
          providerEventType: providerResourceType,
          eventType,
          payload,
          occurredAt: "2026-05-24T12:53:18.084Z",
          sourceOrderKey: `2026-05-24T12:53:18.084Z#linear-webhook-id:${DeliveryId}`,
        },
      });
    },
  );

  it("enriches non-issue update deliveries with changed fields", async () => {
    const payload = createPayload({
      type: "Project",
      action: "update",
      webhookTimestamp: Date.now(),
      updatedFrom: {
        name: "Previous project name",
        status: "planned",
      },
    });
    const rawBody = encodeJson(payload);
    const signature = buildLinearWebhookSignature({
      webhookSecret: WebhookSecret,
      rawBody,
    });
    const resolved = await verifyAndResolveWebhookRequestOrThrow({
      definition: {
        ...LinearBaseDefinition,
        webhookHandler: LinearWebhookHandler,
      },
      targetKey: "linear-default",
      target: {
        familyId: "linear",
        variantId: "linear-default",
        enabled: true,
        config: {},
        secrets: {},
      },
      connections: [
        {
          id: "linear-connection-id",
          status: "active",
          config: {
            connection_method: "api-key",
          },
        },
      ],
      resolveConnectionSecrets: () => ({
        apiKey: "linear-api-key",
      }),
      webhookSourceSecrets: {
        webhookSecret: WebhookSecret,
      },
      headers: {
        "linear-delivery": DeliveryId,
        "linear-event": "Project",
        "linear-signature": signature,
      },
      rawBody,
    });

    expect(resolved).toEqual({
      kind: "event",
      connectionId: "linear-connection-id",
      event: {
        externalEventId: DeliveryId,
        externalDeliveryId: DeliveryId,
        providerEventType: "Project",
        eventType: "linear.project.updated",
        occurredAt: "2026-05-24T12:53:18.084Z",
        sourceOrderKey: `2026-05-24T12:53:18.084Z#linear-webhook-id:${DeliveryId}`,
        payload: {
          ...payload,
          mistle: {
            changedFields: ["name", "status"],
          },
        },
      },
    });
  });

  it("rejects mismatched Linear-Event headers", () => {
    const payload = createIssuePayload();

    expect(() =>
      LinearWebhookHandler.resolveWebhookRequest({
        targetKey: "linear-default",
        target: {
          familyId: "linear",
          variantId: "linear-default",
          enabled: true,
          config: {},
          secrets: {},
        },
        headers: {
          "linear-delivery": DeliveryId,
          "linear-event": "Comment",
        },
        rawBody: encodeJson(payload),
      }),
    ).toThrow("Linear webhook header event 'Comment' does not match payload type 'Issue'.");
  });
});
