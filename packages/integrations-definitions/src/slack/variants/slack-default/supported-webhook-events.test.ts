import { describe, expect, it } from "vitest";

import { SlackThreadRootTimestampField } from "./normalized-event-fields.js";
import { SlackSupportedWebhookEvents } from "./supported-webhook-events.js";

describe("SlackSupportedWebhookEvents", () => {
  it("exposes a resource-backed channel parameter for app mention events", () => {
    const appMentionEvent = SlackSupportedWebhookEvents.find(
      (eventDefinition) => eventDefinition.eventType === "slack:app_mention",
    );

    expect(appMentionEvent?.parameters).toEqual([
      {
        id: "channel",
        label: "channel",
        kind: "resource-select",
        resourceKind: "channel",
        payloadPath: ["event", "channel"],
        prefix: "in",
      },
    ]);
  });

  it("exposes thread-aware payload references and conversation groupings for reaction events", () => {
    const reactionAddedEvent = SlackSupportedWebhookEvents.find(
      (eventDefinition) => eventDefinition.eventType === "slack:reaction_added",
    );

    expect(reactionAddedEvent).toEqual({
      eventType: "slack:reaction_added",
      providerEventType: "reaction_added",
      displayName: "Reaction added",
      category: "Reactions",
      payloadReferences: [
        {
          path: ["event", "channel"],
          description: "Normalized Slack channel ID for the reacted message event.",
        },
        {
          path: ["event", "item", "channel"],
          description: "Slack channel ID for the reacted message.",
        },
        {
          path: ["event", "item", "ts"],
          description: "Slack timestamp for the reacted message.",
        },
        {
          path: ["event", SlackThreadRootTimestampField],
          description:
            "Normalized Slack thread root timestamp used to group reactions on the same thread together.",
        },
        {
          path: ["event", "user"],
          description: "Slack user ID for the actor that added or removed the reaction.",
        },
        {
          path: ["event", "reaction"],
          description: "Slack reaction name.",
        },
      ],
      conversationKeyOptions: [
        {
          id: "channel",
          label: "Channel",
          description: "Events from the same Slack channel go to the same conversation.",
          template: "slack:channel:{{payload.event.channel}}",
        },
        {
          id: "thread",
          label: "Thread",
          description: "Events from the same Slack thread go to the same conversation.",
          template: `slack:thread:{{payload.event.channel}}:{{payload.event.${SlackThreadRootTimestampField}}}`,
        },
        {
          id: "message",
          label: "Message",
          description: "Reactions on the same Slack message go to the same conversation.",
          template: "slack:message:{{payload.event.item.channel}}:{{payload.event.item.ts}}",
        },
      ],
    });
  });
});
