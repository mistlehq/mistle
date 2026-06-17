import type {
  IntegrationWebhookEventDefinition,
  IntegrationWebhookPayloadReference,
} from "@mistle/integrations-core";

const WasenderApiPayloadReferences: readonly IntegrationWebhookPayloadReference[] = [
  {
    path: ["event"],
    description: "WasenderAPI webhook event name.",
  },
  {
    path: ["timestamp"],
    description: "WasenderAPI event timestamp when provided.",
  },
  {
    path: ["sessionId"],
    description: "WasenderAPI WhatsApp session ID when provided.",
  },
  {
    path: ["data"],
    description: "WasenderAPI event payload.",
  },
];

const WasenderApiMessagePayloadReferences: readonly IntegrationWebhookPayloadReference[] = [
  ...WasenderApiPayloadReferences,
  {
    path: ["data", "messages"],
    description: "WasenderAPI message payload or message payload list.",
  },
  {
    path: ["data", "messages", "key", "id"],
    description: "WasenderAPI message ID when a single message object is provided.",
  },
  {
    path: ["data", "messages", "0", "key", "id"],
    description: "WasenderAPI first message ID when a message list is provided.",
  },
  {
    path: ["data", "messages", "key", "remoteJid"],
    description: "WhatsApp remote JID for the message when a single message object is provided.",
  },
  {
    path: ["data", "messages", "0", "key", "remoteJid"],
    description: "WhatsApp remote JID for the first message when a message list is provided.",
  },
  {
    path: ["data", "messages", "messageBody"],
    description: "Message body when a single message object is provided.",
  },
  {
    path: ["data", "messages", "0", "messageBody"],
    description: "First message body when a message list is provided.",
  },
];

const WasenderApiProviderEventTypes = {
  MESSAGES_UPSERT: "messages.upsert",
  MESSAGES_RECEIVED: "messages.received",
} as const;

function createWasenderApiMessageConversationKeyTemplate(input: {
  scope: "chat" | "message";
  field: "id" | "remoteJid";
}): string {
  return `wasenderapi:${input.scope}:{% if payload.data.messages.key %}{{payload.data.messages.key.${input.field}}}{% else %}{{payload.data.messages[0].key.${input.field}}}{% endif %}`;
}

const WasenderApiMessageConversationKeyOptions = [
  {
    id: "remote-jid",
    label: "Chat",
    description: "Message events from the same WhatsApp chat go to the same conversation.",
    template: createWasenderApiMessageConversationKeyTemplate({
      scope: "chat",
      field: "remoteJid",
    }),
  },
  {
    id: "message",
    label: "Message",
    description: "Events for the same WasenderAPI message go to the same conversation.",
    template: createWasenderApiMessageConversationKeyTemplate({
      scope: "message",
      field: "id",
    }),
  },
];

function createWasenderApiWebhookEventDefinition(input: {
  eventType: string;
  displayName: string;
  category: string;
  payloadReferences: readonly IntegrationWebhookPayloadReference[];
  conversationKeyOptions?: IntegrationWebhookEventDefinition["conversationKeyOptions"];
}): IntegrationWebhookEventDefinition {
  return {
    eventType: `wasenderapi.${input.eventType}`,
    providerEventType: input.eventType,
    displayName: input.displayName,
    category: input.category,
    requirements: {
      anyOf: [{ event: input.eventType }],
    },
    payloadReferences: input.payloadReferences,
    ...(input.conversationKeyOptions === undefined
      ? {}
      : { conversationKeyOptions: input.conversationKeyOptions }),
  };
}

export const WasenderApiSupportedWebhookEvents: readonly IntegrationWebhookEventDefinition[] = [
  createWasenderApiWebhookEventDefinition({
    eventType: WasenderApiProviderEventTypes.MESSAGES_UPSERT,
    displayName: "Message upsert",
    category: "Messages",
    payloadReferences: WasenderApiMessagePayloadReferences,
    conversationKeyOptions: WasenderApiMessageConversationKeyOptions,
  }),
  createWasenderApiWebhookEventDefinition({
    eventType: WasenderApiProviderEventTypes.MESSAGES_RECEIVED,
    displayName: "Message received",
    category: "Messages",
    payloadReferences: WasenderApiMessagePayloadReferences,
    conversationKeyOptions: WasenderApiMessageConversationKeyOptions,
  }),
];
