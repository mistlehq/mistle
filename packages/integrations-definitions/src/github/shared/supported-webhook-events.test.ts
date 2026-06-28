import { describe, expect, it } from "vitest";

import { GitHubSupportedWebhookEvents } from "./supported-webhook-events.js";

describe("GitHubSupportedWebhookEvents", () => {
  it("declares sender actors for GitHub webhook events", () => {
    const issueCommentEvent = GitHubSupportedWebhookEvents.find(
      (eventDefinition) => eventDefinition.eventType === "github.issue_comment.created",
    );

    expect(issueCommentEvent?.actor).toEqual({
      resourceReferences: [
        {
          resourceKind: "user",
          externalIdPayloadPath: ["sender", "id"],
          handlePayloadPath: ["sender", "login"],
          when: {
            payloadPath: ["sender", "type"],
            equals: "User",
          },
        },
        {
          resourceKind: "bot",
          externalIdPayloadPath: ["sender", "id"],
          handlePayloadPath: ["sender", "login"],
          when: {
            payloadPath: ["sender", "type"],
            equals: "Bot",
          },
        },
      ],
    });
  });
});
