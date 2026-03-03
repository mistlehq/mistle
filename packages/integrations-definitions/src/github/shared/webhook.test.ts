import { sign } from "@octokit/webhooks-methods";
import { describe, expect, it } from "vitest";

import { GitHubWebhookHandler } from "./webhook.js";

const encoder = new TextEncoder();

function encodePayload(input: Record<string, unknown>): Uint8Array {
  return encoder.encode(JSON.stringify(input));
}

describe("GitHubWebhookHandler", () => {
  it("verifies webhook signature with webhookSecret", async () => {
    const payloadString = JSON.stringify({
      action: "created",
      installation: {
        id: 12345,
      },
    });
    const signature = await sign("whsec_123", payloadString);

    const verificationResult = await GitHubWebhookHandler.verify({
      targetKey: "github_cloud",
      target: {
        familyId: "github",
        variantId: "github-cloud",
        enabled: true,
        config: {
          apiBaseUrl: "https://api.github.com/",
          webBaseUrl: "https://github.com/",
          webhookSecret: "whsec_123",
        },
      },
      headers: {
        "x-hub-signature-256": signature,
      },
      rawBody: encoder.encode(payloadString),
    });

    expect(verificationResult).toEqual({
      ok: true,
    });
  });

  it("fails verification when webhook secret is missing", async () => {
    const verificationResult = await GitHubWebhookHandler.verify({
      targetKey: "github_cloud",
      target: {
        familyId: "github",
        variantId: "github-cloud",
        enabled: true,
        config: {
          apiBaseUrl: "https://api.github.com/",
          webBaseUrl: "https://github.com/",
        },
      },
      headers: {
        "x-hub-signature-256": "sha256=invalid",
      },
      rawBody: encodePayload({
        action: "created",
      }),
    });

    expect(verificationResult).toEqual({
      ok: false,
      code: "invalid-body",
      message: "GitHub webhook target config is missing webhookSecret.",
    });
  });

  it("fails verification when signature header is missing", async () => {
    const verificationResult = await GitHubWebhookHandler.verify({
      targetKey: "github_cloud",
      target: {
        familyId: "github",
        variantId: "github-cloud",
        enabled: true,
        config: {
          apiBaseUrl: "https://api.github.com/",
          webBaseUrl: "https://github.com/",
          webhookSecret: "whsec_123",
        },
      },
      headers: {},
      rawBody: encodePayload({
        action: "created",
      }),
    });

    expect(verificationResult).toEqual({
      ok: false,
      code: "invalid-headers",
      message: "GitHub webhook is missing x-hub-signature-256 header.",
    });
  });

  it("parses issue_comment created events", () => {
    const parsed = GitHubWebhookHandler.parse({
      targetKey: "github_cloud",
      target: {
        familyId: "github",
        variantId: "github-cloud",
        enabled: true,
        config: {
          apiBaseUrl: "https://api.github.com/",
          webBaseUrl: "https://github.com/",
          webhookSecret: "whsec_123",
        },
      },
      headers: {
        "x-github-event": "issue_comment",
        "x-github-delivery": "delivery_123",
      },
      rawBody: encodePayload({
        action: "created",
        installation: {
          id: 98765,
        },
        comment: {
          body: "hello world",
        },
      }),
    });

    expect(parsed).toEqual({
      externalEventId: "delivery_123",
      externalDeliveryId: "delivery_123",
      providerEventType: "issue_comment",
      eventType: "github.issue_comment.created",
      payload: {
        action: "created",
        installation: {
          id: 98765,
        },
        comment: {
          body: "hello world",
        },
      },
      connectionRef: {
        targetKey: "github_cloud",
        externalSubjectId: "98765",
      },
    });
  });

  it("maps pull_request_review_comment created to pull_request_comment", async () => {
    const parsed = await GitHubWebhookHandler.parse({
      targetKey: "github_cloud",
      target: {
        familyId: "github",
        variantId: "github-cloud",
        enabled: true,
        config: {
          apiBaseUrl: "https://api.github.com/",
          webBaseUrl: "https://github.com/",
          webhookSecret: "whsec_123",
        },
      },
      headers: {
        "x-github-event": "pull_request_review_comment",
        "x-github-delivery": "delivery_456",
      },
      rawBody: encodePayload({
        action: "created",
        installation: {
          id: "10001",
        },
      }),
    });

    expect(parsed.eventType).toBe("github.pull_request_comment.created");
  });

  it("returns derived event type for unsupported events", async () => {
    const parsed = await GitHubWebhookHandler.parse({
      targetKey: "github_cloud",
      target: {
        familyId: "github",
        variantId: "github-cloud",
        enabled: true,
        config: {
          apiBaseUrl: "https://api.github.com/",
          webBaseUrl: "https://github.com/",
          webhookSecret: "whsec_123",
        },
      },
      headers: {
        "x-github-event": "issues",
        "x-github-delivery": "delivery_789",
      },
      rawBody: encodePayload({
        action: "opened",
        installation: {
          id: "10001",
        },
      }),
    });

    expect(parsed.eventType).toBe("github.issues.opened");
  });

  it("fails when x-github-delivery header is missing", () => {
    expect(() =>
      GitHubWebhookHandler.parse({
        targetKey: "github_cloud",
        target: {
          familyId: "github",
          variantId: "github-cloud",
          enabled: true,
          config: {
            apiBaseUrl: "https://api.github.com/",
            webBaseUrl: "https://github.com/",
            webhookSecret: "whsec_123",
          },
        },
        headers: {
          "x-github-event": "issue_comment",
        },
        rawBody: encodePayload({
          action: "created",
          installation: {
            id: 111,
          },
        }),
      }),
    ).toThrowError("GitHub webhook is missing x-github-delivery header.");
  });

  it("fails when installation id is missing from payload", () => {
    expect(() =>
      GitHubWebhookHandler.parse({
        targetKey: "github_cloud",
        target: {
          familyId: "github",
          variantId: "github-cloud",
          enabled: true,
          config: {
            apiBaseUrl: "https://api.github.com/",
            webBaseUrl: "https://github.com/",
            webhookSecret: "whsec_123",
          },
        },
        headers: {
          "x-github-event": "issue_comment",
          "x-github-delivery": "delivery_111",
        },
        rawBody: encodePayload({
          action: "created",
        }),
      }),
    ).toThrowError("GitHub webhook payload is missing installation context.");
  });
});
