import type {
  IntegrationWebhookEventDefinition,
  IntegrationWebhookPayloadReference,
} from "@mistle/integrations-core";

const WhapiPayloadReferences: readonly IntegrationWebhookPayloadReference[] = [
  {
    path: ["event", "type"],
    description: "Whapi webhook object type.",
  },
  {
    path: ["event", "event"],
    description: "Whapi webhook update type.",
  },
  {
    path: ["channel_id"],
    description: "Whapi channel ID that emitted the callback.",
  },
];

const WhapiMessagePayloadReferences: readonly IntegrationWebhookPayloadReference[] = [
  ...WhapiPayloadReferences,
  {
    path: ["messages"],
    description: "Whapi message payload list.",
  },
  {
    path: ["messages", "0", "id"],
    description: "Whapi first message ID.",
  },
  {
    path: ["messages", "0", "chat_id"],
    description: "WhatsApp chat ID for the first message.",
  },
  {
    path: ["messages", "0", "from"],
    description: "WhatsApp sender ID for the first message.",
  },
  {
    path: ["messages", "0", "text", "body"],
    description: "Text body for the first text message.",
  },
];

const WhapiStatusPayloadReferences: readonly IntegrationWebhookPayloadReference[] = [
  ...WhapiPayloadReferences,
  {
    path: ["statuses"],
    description: "Whapi message status payload list.",
  },
  {
    path: ["statuses", "0", "id"],
    description: "Whapi first status message ID.",
  },
  {
    path: ["statuses", "0", "status"],
    description: "Whapi first status value.",
  },
  {
    path: ["statuses", "0", "recipient_id"],
    description: "WhatsApp recipient ID for the first status.",
  },
];

const WhapiChannelPayloadReferences: readonly IntegrationWebhookPayloadReference[] = [
  ...WhapiPayloadReferences,
  {
    path: ["status"],
    description: "Whapi account or device status when provided.",
  },
];

const WhapiUserPayloadReferences: readonly IntegrationWebhookPayloadReference[] = [
  ...WhapiPayloadReferences,
  {
    path: ["user", "id"],
    description: "WhatsApp account user ID that connected or disconnected.",
  },
  {
    path: ["user", "name"],
    description: "WhatsApp account display name when provided.",
  },
];

const WhapiProviderEventTypes = {
  MESSAGES_POST: "messages.post",
  MESSAGES_PUT: "messages.put",
  MESSAGES_PATCH: "messages.patch",
  STATUSES_POST: "statuses.post",
  STATUSES_PUT: "statuses.put",
  CHANNEL_POST: "channel.post",
  USERS_POST: "users.post",
  USERS_DELETE: "users.delete",
};

function createWhapiMessageConversationKeyTemplate(input: {
  scope: "chat" | "message";
  field: "chat_id" | "id";
}): string {
  return `whapi:${input.scope}:{{payload.messages[0].${input.field}}}`;
}

const WhapiMessageConversationKeyOptions = [
  {
    id: "chat",
    label: "Chat",
    description: "Message events from the same WhatsApp chat go to the same conversation.",
    template: createWhapiMessageConversationKeyTemplate({
      scope: "chat",
      field: "chat_id",
    }),
  },
  {
    id: "message",
    label: "Message",
    description: "Events for the same Whapi message go to the same conversation.",
    template: createWhapiMessageConversationKeyTemplate({
      scope: "message",
      field: "id",
    }),
  },
];

function createWhapiWebhookEventDefinition(input: {
  providerEventType: string;
  displayName: string;
  category: string;
  payloadReferences: readonly IntegrationWebhookPayloadReference[];
  conversationKeyOptions?: IntegrationWebhookEventDefinition["conversationKeyOptions"];
}): IntegrationWebhookEventDefinition {
  return {
    eventType: `whapi.${input.providerEventType}`,
    providerEventType: input.providerEventType,
    displayName: input.displayName,
    category: input.category,
    requirements: {
      anyOf: [{ event: input.providerEventType }],
    },
    payloadReferences: input.payloadReferences,
    ...(input.conversationKeyOptions === undefined
      ? {}
      : { conversationKeyOptions: input.conversationKeyOptions }),
  };
}

export const WhapiSupportedWebhookEvents: readonly IntegrationWebhookEventDefinition[] = [
  createWhapiWebhookEventDefinition({
    providerEventType: WhapiProviderEventTypes.MESSAGES_POST,
    displayName: "Message created",
    category: "Messages",
    payloadReferences: WhapiMessagePayloadReferences,
    conversationKeyOptions: WhapiMessageConversationKeyOptions,
  }),
  createWhapiWebhookEventDefinition({
    providerEventType: WhapiProviderEventTypes.MESSAGES_PUT,
    displayName: "Message updated",
    category: "Messages",
    payloadReferences: WhapiMessagePayloadReferences,
    conversationKeyOptions: WhapiMessageConversationKeyOptions,
  }),
  createWhapiWebhookEventDefinition({
    providerEventType: WhapiProviderEventTypes.MESSAGES_PATCH,
    displayName: "Message patched",
    category: "Messages",
    payloadReferences: WhapiMessagePayloadReferences,
    conversationKeyOptions: WhapiMessageConversationKeyOptions,
  }),
  createWhapiWebhookEventDefinition({
    providerEventType: WhapiProviderEventTypes.STATUSES_POST,
    displayName: "Status created",
    category: "Statuses",
    payloadReferences: WhapiStatusPayloadReferences,
  }),
  createWhapiWebhookEventDefinition({
    providerEventType: WhapiProviderEventTypes.STATUSES_PUT,
    displayName: "Status updated",
    category: "Statuses",
    payloadReferences: WhapiStatusPayloadReferences,
  }),
  createWhapiWebhookEventDefinition({
    providerEventType: WhapiProviderEventTypes.CHANNEL_POST,
    displayName: "Channel status changed",
    category: "Channel",
    payloadReferences: WhapiChannelPayloadReferences,
  }),
  createWhapiWebhookEventDefinition({
    providerEventType: WhapiProviderEventTypes.USERS_POST,
    displayName: "User connected",
    category: "Users",
    payloadReferences: WhapiUserPayloadReferences,
  }),
  createWhapiWebhookEventDefinition({
    providerEventType: WhapiProviderEventTypes.USERS_DELETE,
    displayName: "User disconnected",
    category: "Users",
    payloadReferences: WhapiUserPayloadReferences,
  }),
];
