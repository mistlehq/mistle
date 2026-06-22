import { describe, expect, it } from "vitest";

import { SlackThreadRootTimestampField } from "./normalized-event-fields.js";
import { SlackSupportedWebhookEvents } from "./supported-webhook-events.js";

describe("SlackSupportedWebhookEvents", () => {
  it("exposes channel, sender, text, and thread filters for message events", () => {
    const messageEvent = SlackSupportedWebhookEvents.find(
      (eventDefinition) => eventDefinition.eventType === "slack:message",
    );

    expect(messageEvent?.parameters).toEqual([
      {
        id: "invocationToken",
        label: "invocation token",
        kind: "string",
        payloadPath: ["event", "text"],
        matchMode: "contains_token",
        controlVariant: "invocation-token",
      },
      {
        id: "channel",
        label: "channel",
        kind: "resource-select",
        resourceKind: "channel",
        payloadPath: ["event", "channel"],
        prefix: "in",
        multiValue: true,
      },
      {
        id: "sender",
        label: "sender user ID",
        kind: "string",
        payloadPath: ["event", "user"],
        prefix: "from",
        placeholder: "U1234567890",
      },
      {
        id: "messageText",
        label: "message text",
        kind: "string",
        payloadPath: ["event", "text"],
        matchMode: "contains",
        prefix: "containing",
        placeholder: "deployment failed",
      },
      {
        id: "threadReply",
        label: "thread reply",
        kind: "enum-select",
        payloadPath: ["event", "thread_ts"],
        matchMode: "exists",
        options: [
          {
            value: "exists",
            label: "is in a thread",
          },
          {
            value: "not_exists",
            label: "is not in a thread",
          },
        ],
      },
    ]);
  });

  it("exposes a resource-backed channel parameter for app mention events", () => {
    const appMentionEvent = SlackSupportedWebhookEvents.find(
      (eventDefinition) => eventDefinition.eventType === "slack:app_mention",
    );

    expect(appMentionEvent?.payloadReferences).toContainEqual({
      path: ["event"],
      description: "Slack event payload object.",
    });
    expect(appMentionEvent?.parameters).toEqual([
      {
        id: "invocationToken",
        label: "invocation token",
        kind: "string",
        payloadPath: ["event", "text"],
        matchMode: "contains_token",
        controlVariant: "invocation-token",
      },
      {
        id: "channel",
        label: "channel",
        kind: "resource-select",
        resourceKind: "channel",
        payloadPath: ["event", "channel"],
        prefix: "in",
        multiValue: true,
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
      requirements: {
        anyOf: [
          {
            event: "reaction_added",
            permissions: [{ permission: "reactions:read" }],
          },
        ],
      },
      payloadReferences: [
        {
          path: ["event"],
          description: "Slack event payload object.",
        },
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
      parameters: [
        {
          id: "channel",
          label: "channel",
          kind: "resource-select",
          resourceKind: "channel",
          payloadPath: ["event", "channel"],
          prefix: "in",
          multiValue: true,
        },
        {
          id: "reaction",
          label: "reaction",
          kind: "string",
          payloadPath: ["event", "reaction"],
          prefix: "named",
          placeholder: "thumbsup",
        },
        {
          id: "reactingUser",
          label: "reacting user ID",
          kind: "string",
          payloadPath: ["event", "user"],
          prefix: "by",
          placeholder: "U1234567890",
        },
        {
          id: "reactedMessageAuthor",
          label: "message author user ID",
          kind: "string",
          payloadPath: ["event", "item_user"],
          prefix: "on message by",
          placeholder: "U1234567890",
          negatedMatchRequiresExists: true,
        },
      ],
    });
  });
});
