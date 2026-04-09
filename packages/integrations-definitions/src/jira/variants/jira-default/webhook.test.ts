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
          webhookSecret: "whsec_jira",
        },
        webhookSourceSecrets: {},
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
});
