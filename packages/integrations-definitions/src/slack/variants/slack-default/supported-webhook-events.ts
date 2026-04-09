import type {
  IntegrationWebhookEventDefinition,
  IntegrationWebhookPayloadReference,
} from "@mistle/integrations-core";

import { SlackThreadRootTimestampField } from "./normalized-event-fields.js";

const SlackMessagePayloadReferences: readonly IntegrationWebhookPayloadReference[] = [
  {
    path: ["event", "channel"],
    description: "Slack channel ID for the message event.",
  },
  {
    path: ["event", "ts"],
    description: "Slack message timestamp for the event.",
  },
  {
    path: ["event", "thread_ts"],
    description: "Slack thread timestamp when the message belongs to a thread.",
  },
  {
    path: ["event", SlackThreadRootTimestampField],
    description:
      "Normalized Slack thread root timestamp used to group top-level messages and thread replies together.",
  },
  {
    path: ["event", "user"],
    description: "Slack user ID for the actor that sent the message.",
  },
  {
    path: ["event", "text"],
    description: "Slack message text.",
  },
];

const SlackReactionPayloadReferences: readonly IntegrationWebhookPayloadReference[] = [
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
];

const SlackChannelConversationKeyOption = {
  id: "channel",
  label: "Channel",
  description: "Events from the same Slack channel go to the same conversation.",
  template: "slack:channel:{{payload.event.channel}}",
};

const SlackThreadConversationKeyOption = {
  id: "thread",
  label: "Thread",
  description: "Events from the same Slack thread go to the same conversation.",
  template: `slack:thread:{{payload.event.channel}}:{{payload.event.${SlackThreadRootTimestampField}}}`,
};

const SlackReactedMessageConversationKeyOption = {
  id: "message",
  label: "Message",
  description: "Reactions on the same Slack message go to the same conversation.",
  template: "slack:message:{{payload.event.item.channel}}:{{payload.event.item.ts}}",
};

function createSlackWebhookEventDefinition(input: {
  eventType: string;
  providerEventType: string;
  displayName: string;
  category: string;
  payloadReferences: readonly IntegrationWebhookPayloadReference[];
  conversationKeyOptions: readonly {
    id: string;
    label: string;
    description: string;
    template: string;
  }[];
}): IntegrationWebhookEventDefinition {
  return {
    eventType: input.eventType,
    providerEventType: input.providerEventType,
    displayName: input.displayName,
    category: input.category,
    payloadReferences: input.payloadReferences,
    conversationKeyOptions: input.conversationKeyOptions,
  };
}

export const SlackSupportedWebhookEvents: readonly IntegrationWebhookEventDefinition[] = [
  createSlackWebhookEventDefinition({
    eventType: "slack:message",
    providerEventType: "message",
    displayName: "Message",
    category: "Messages",
    payloadReferences: SlackMessagePayloadReferences,
    conversationKeyOptions: [SlackChannelConversationKeyOption, SlackThreadConversationKeyOption],
  }),
  createSlackWebhookEventDefinition({
    eventType: "slack:app_mention",
    providerEventType: "app_mention",
    displayName: "App mention",
    category: "Messages",
    payloadReferences: SlackMessagePayloadReferences,
    conversationKeyOptions: [SlackChannelConversationKeyOption, SlackThreadConversationKeyOption],
  }),
  createSlackWebhookEventDefinition({
    eventType: "slack:reaction_added",
    providerEventType: "reaction_added",
    displayName: "Reaction added",
    category: "Reactions",
    payloadReferences: SlackReactionPayloadReferences,
    conversationKeyOptions: [
      SlackChannelConversationKeyOption,
      SlackThreadConversationKeyOption,
      SlackReactedMessageConversationKeyOption,
    ],
  }),
  createSlackWebhookEventDefinition({
    eventType: "slack:reaction_removed",
    providerEventType: "reaction_removed",
    displayName: "Reaction removed",
    category: "Reactions",
    payloadReferences: SlackReactionPayloadReferences,
    conversationKeyOptions: [
      SlackChannelConversationKeyOption,
      SlackThreadConversationKeyOption,
      SlackReactedMessageConversationKeyOption,
    ],
  }),
];
