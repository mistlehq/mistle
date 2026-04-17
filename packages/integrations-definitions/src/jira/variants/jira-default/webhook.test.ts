import { describe, expect, it } from "vitest";

import {
  JiraWebhookHandler,
  buildJiraWebhookSignature,
  verifyJiraWebhookSignature,
} from "./webhook.server.js";

function createJiraIssueCreatedPayload(): Record<string, unknown> {
  return {
    timestamp: 1_775_151_763_000,
    webhookEvent: "jira:issue_created",
    issue_event_type_name: "issue_created",
    issue: {
      id: "10001",
      self: "https://mistle-test.atlassian.net/rest/api/2/issue/10001",
      key: "MST-101",
    },
    user: {
      accountId: "user-123",
    },
  };
}

describe("jira webhook handler", () => {
  it("resolves Jira webhook requests from the identifier header", () => {
    const payload = createJiraIssueCreatedPayload();
    const rawBody = new TextEncoder().encode(JSON.stringify(payload));

    const resolved = JiraWebhookHandler.resolveWebhookRequest({
      targetKey: "jira-default",
      target: {
        familyId: "jira",
        variantId: "jira-default",
        enabled: true,
        config: {},
        secrets: {},
      },
      headers: {
        "x-atlassian-webhook-identifier": "jira-webhook-evt-1",
      },
      rawBody,
    });

    expect(resolved).toEqual({
      kind: "event",
      event: {
        externalEventId: "jira-webhook-evt-1",
        externalDeliveryId: "jira-webhook-evt-1",
        providerEventType: "jira:issue_created",
        eventType: "jira:issue_created",
        payload,
        occurredAt: "2026-04-02T17:42:43.000Z",
      },
    });
  });

  it("resolves the single path-routed Jira connection", () => {
    const resolved = JiraWebhookHandler.resolveConnection({
      targetKey: "jira-default",
      target: {
        familyId: "jira",
        variantId: "jira-default",
        enabled: true,
        config: {},
        secrets: {},
      },
      event: {
        externalEventId: "evt-1",
        eventType: "jira:issue_created",
        providerEventType: "jira:issue_created",
        payload: createJiraIssueCreatedPayload(),
      },
      candidates: [
        {
          id: "icn_jira",
          status: "active",
          config: {
            connection_method: "jira-personal-api-token",
            site_url: "https://mistle-test.atlassian.net",
            email: "jira@example.com",
          },
        },
      ],
    });

    expect(resolved).toEqual({
      ok: true,
      connectionId: "icn_jira",
    });
  });

  it("verifies valid Jira webhook signatures", () => {
    const rawBody = new TextEncoder().encode(JSON.stringify(createJiraIssueCreatedPayload()));
    const signature = buildJiraWebhookSignature({
      webhookSecret: "whsec_jira",
      method: "sha256",
      rawBody,
    });

    expect(
      JiraWebhookHandler.verify({
        targetKey: "jira-default",
        target: {
          familyId: "jira",
          variantId: "jira-default",
          enabled: true,
          config: {},
          secrets: {},
        },
        event: {
          externalEventId: "evt-1",
          eventType: "jira:issue_created",
          providerEventType: "jira:issue_created",
          payload: createJiraIssueCreatedPayload(),
        },
        connection: {
          id: "icn_jira",
          status: "active",
          config: {
            connection_method: "jira-personal-api-token",
            site_url: "https://mistle-test.atlassian.net",
            email: "jira@example.com",
          },
        },
        connectionSecrets: {
          apiKey: "jira-personal-token",
        },
        webhookSourceSecrets: {
          webhookSecret: "whsec_jira",
        },
        headers: {
          "x-hub-signature": signature,
        },
        rawBody,
      }),
    ).toEqual({
      ok: true,
    });
  });

  it("rejects invalid Jira webhook signatures", () => {
    const rawBody = new TextEncoder().encode(JSON.stringify(createJiraIssueCreatedPayload()));

    expect(
      verifyJiraWebhookSignature({
        webhookSecret: "whsec_jira",
        rawBody,
        signature: "sha256=deadbeef",
      }),
    ).toEqual({
      ok: false,
      code: "invalid-signature",
      message: "Jira webhook signature verification failed.",
    });
  });

  it("normalizes rich-text Jira comment bodies without losing invocation-token boundaries", () => {
    const payload = {
      timestamp: 1_775_151_763_000,
      webhookEvent: "comment_created",
      issue: {
        id: "10001",
        self: "https://mistle-test.atlassian.net/rest/api/2/issue/10001",
        key: "MST-101",
      },
      comment: {
        id: "20001",
        body: {
          type: "doc",
          content: [
            {
              type: "paragraph",
              content: [
                {
                  type: "text",
                  text: "@mistlebot",
                },
              ],
            },
            {
              type: "paragraph",
              content: [
                {
                  type: "text",
                  text: "please review",
                },
              ],
            },
          ],
        },
      },
    } satisfies Record<string, unknown>;
    const rawBody = new TextEncoder().encode(JSON.stringify(payload));

    const resolved = JiraWebhookHandler.resolveWebhookRequest({
      targetKey: "jira-default",
      target: {
        familyId: "jira",
        variantId: "jira-default",
        enabled: true,
        config: {},
        secrets: {},
      },
      headers: {
        "x-atlassian-webhook-identifier": "jira-webhook-comment-1",
      },
      rawBody,
    });

    expect(resolved).toEqual({
      kind: "event",
      event: {
        externalEventId: "jira-webhook-comment-1",
        externalDeliveryId: "jira-webhook-comment-1",
        providerEventType: "comment_created",
        eventType: "comment_created",
        payload: {
          ...payload,
          comment: {
            ...payload.comment,
            mistlePlainText: "@mistlebot please review",
          },
        },
        occurredAt: "2026-04-02T17:42:43.000Z",
        sourceOrderKey: "2026-04-02T17:42:43.000Z#20001",
      },
    });
  });

  it("preserves invocation-token boundaries across Jira hard breaks", () => {
    const payload = {
      timestamp: 1_775_151_763_000,
      webhookEvent: "comment_created",
      issue: {
        id: "10001",
        self: "https://mistle-test.atlassian.net/rest/api/2/issue/10001",
        key: "MST-101",
      },
      comment: {
        id: "20002",
        body: {
          type: "doc",
          content: [
            {
              type: "paragraph",
              content: [
                {
                  type: "text",
                  text: "@mistlebot",
                },
                {
                  type: "hardBreak",
                },
                {
                  type: "text",
                  text: "please review",
                },
              ],
            },
          ],
        },
      },
    } satisfies Record<string, unknown>;
    const rawBody = new TextEncoder().encode(JSON.stringify(payload));

    const resolved = JiraWebhookHandler.resolveWebhookRequest({
      targetKey: "jira-default",
      target: {
        familyId: "jira",
        variantId: "jira-default",
        enabled: true,
        config: {},
        secrets: {},
      },
      headers: {
        "x-atlassian-webhook-identifier": "jira-webhook-comment-2",
      },
      rawBody,
    });

    expect(resolved).toEqual({
      kind: "event",
      event: {
        externalEventId: "jira-webhook-comment-2",
        externalDeliveryId: "jira-webhook-comment-2",
        providerEventType: "comment_created",
        eventType: "comment_created",
        payload: {
          ...payload,
          comment: {
            ...payload.comment,
            mistlePlainText: "@mistlebot please review",
          },
        },
        occurredAt: "2026-04-02T17:42:43.000Z",
        sourceOrderKey: "2026-04-02T17:42:43.000Z#20002",
      },
    });
  });

  it("keeps inline Jira text runs contiguous when formatting splits a token", () => {
    const payload = {
      timestamp: 1_775_151_763_000,
      webhookEvent: "comment_created",
      issue: {
        id: "10001",
        self: "https://mistle-test.atlassian.net/rest/api/2/issue/10001",
        key: "MST-101",
      },
      comment: {
        id: "20003",
        body: {
          type: "doc",
          content: [
            {
              type: "paragraph",
              content: [
                {
                  type: "text",
                  text: "@mistle",
                },
                {
                  type: "text",
                  text: "bot",
                  marks: [{ type: "strong" }],
                },
                {
                  type: "text",
                  text: " please review /tri",
                },
                {
                  type: "text",
                  text: "age",
                  marks: [{ type: "em" }],
                },
              ],
            },
          ],
        },
      },
    } satisfies Record<string, unknown>;
    const rawBody = new TextEncoder().encode(JSON.stringify(payload));

    const resolved = JiraWebhookHandler.resolveWebhookRequest({
      targetKey: "jira-default",
      target: {
        familyId: "jira",
        variantId: "jira-default",
        enabled: true,
        config: {},
        secrets: {},
      },
      headers: {
        "x-atlassian-webhook-identifier": "jira-webhook-comment-3",
      },
      rawBody,
    });

    expect(resolved).toEqual({
      kind: "event",
      event: {
        externalEventId: "jira-webhook-comment-3",
        externalDeliveryId: "jira-webhook-comment-3",
        providerEventType: "comment_created",
        eventType: "comment_created",
        payload: {
          ...payload,
          comment: {
            ...payload.comment,
            mistlePlainText: "@mistlebot please review /triage",
          },
        },
        occurredAt: "2026-04-02T17:42:43.000Z",
        sourceOrderKey: "2026-04-02T17:42:43.000Z#20003",
      },
    });
  });
});
