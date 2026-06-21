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

const WhapiChatPayloadReferences: readonly IntegrationWebhookPayloadReference[] = [
  ...WhapiPayloadReferences,
  {
    path: ["chats"],
    description: "Whapi chat payload list.",
  },
  {
    path: ["chats", "0", "id"],
    description: "Whapi first chat ID.",
  },
  {
    path: ["chats", "0", "name"],
    description: "Whapi first chat display name when provided.",
  },
  {
    path: ["changes"],
    description: "Whapi chat changes for patch events when provided.",
  },
];

const WhapiContactPayloadReferences: readonly IntegrationWebhookPayloadReference[] = [
  ...WhapiPayloadReferences,
  {
    path: ["contacts"],
    description: "Whapi contact payload list.",
  },
  {
    path: ["contacts", "0", "id"],
    description: "Whapi first contact ID.",
  },
  {
    path: ["changes"],
    description: "Whapi contact changes for patch events when provided.",
  },
];

const WhapiGroupPayloadReferences: readonly IntegrationWebhookPayloadReference[] = [
  ...WhapiPayloadReferences,
  {
    path: ["groups"],
    description: "Whapi group payload list.",
  },
  {
    path: ["groups", "0", "id"],
    description: "Whapi first group ID.",
  },
  {
    path: ["changes"],
    description: "Whapi group changes for patch events when provided.",
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

const WhapiPresencePayloadReferences: readonly IntegrationWebhookPayloadReference[] = [
  ...WhapiPayloadReferences,
  {
    path: ["presences"],
    description: "Whapi presence payload list.",
  },
  {
    path: ["presences", "0", "id"],
    description: "Whapi first presence account or chat ID.",
  },
];

const WhapiChannelPayloadReferences: readonly IntegrationWebhookPayloadReference[] = [
  ...WhapiPayloadReferences,
  {
    path: ["status"],
    description: "Whapi account or device status when provided.",
  },
];

const WhapiLabelPayloadReferences: readonly IntegrationWebhookPayloadReference[] = [
  ...WhapiPayloadReferences,
  {
    path: ["labels"],
    description: "Whapi label payload list.",
  },
  {
    path: ["labels", "0", "id"],
    description: "Whapi first label ID.",
  },
  {
    path: ["labels", "0", "name"],
    description: "Whapi first label name when provided.",
  },
];

const WhapiCallPayloadReferences: readonly IntegrationWebhookPayloadReference[] = [
  ...WhapiPayloadReferences,
  {
    path: ["calls"],
    description: "Whapi call payload list.",
  },
  {
    path: ["calls", "0", "id"],
    description: "Whapi first call ID.",
  },
  {
    path: ["calls", "0", "from"],
    description: "WhatsApp caller ID for the first call when provided.",
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
  MESSAGES_DELETE: "messages.delete",
  STATUSES_POST: "statuses.post",
  STATUSES_PUT: "statuses.put",
  CHATS_POST: "chats.post",
  CHATS_PUT: "chats.put",
  CHATS_DELETE: "chats.delete",
  CHATS_PATCH: "chats.patch",
  CONTACTS_POST: "contacts.post",
  CONTACTS_PATCH: "contacts.patch",
  GROUPS_POST: "groups.post",
  GROUPS_PUT: "groups.put",
  GROUPS_PATCH: "groups.patch",
  PRESENCES_POST: "presences.post",
  CHANNEL_POST: "channel.post",
  CHANNEL_PATCH: "channel.patch",
  USERS_POST: "users.post",
  USERS_DELETE: "users.delete",
  LABELS_POST: "labels.post",
  LABELS_DELETE: "labels.delete",
  CALLS_POST: "calls.post",
};

// Source: WHAPI webhook settings UI and GET /settings/events documented at
// https://whapi.readme.io/reference/getallowedevents.
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
    providerEventType: WhapiProviderEventTypes.MESSAGES_DELETE,
    displayName: "Message deleted",
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
    providerEventType: WhapiProviderEventTypes.CHATS_POST,
    displayName: "Chat created",
    category: "Chats",
    payloadReferences: WhapiChatPayloadReferences,
  }),
  createWhapiWebhookEventDefinition({
    providerEventType: WhapiProviderEventTypes.CHATS_PUT,
    displayName: "Chat updated",
    category: "Chats",
    payloadReferences: WhapiChatPayloadReferences,
  }),
  createWhapiWebhookEventDefinition({
    providerEventType: WhapiProviderEventTypes.CHATS_DELETE,
    displayName: "Chat deleted",
    category: "Chats",
    payloadReferences: WhapiChatPayloadReferences,
  }),
  createWhapiWebhookEventDefinition({
    providerEventType: WhapiProviderEventTypes.CHATS_PATCH,
    displayName: "Chat patched",
    category: "Chats",
    payloadReferences: WhapiChatPayloadReferences,
  }),
  createWhapiWebhookEventDefinition({
    providerEventType: WhapiProviderEventTypes.CONTACTS_POST,
    displayName: "Contact created",
    category: "Contacts",
    payloadReferences: WhapiContactPayloadReferences,
  }),
  createWhapiWebhookEventDefinition({
    providerEventType: WhapiProviderEventTypes.CONTACTS_PATCH,
    displayName: "Contact patched",
    category: "Contacts",
    payloadReferences: WhapiContactPayloadReferences,
  }),
  createWhapiWebhookEventDefinition({
    providerEventType: WhapiProviderEventTypes.GROUPS_POST,
    displayName: "Group created",
    category: "Groups",
    payloadReferences: WhapiGroupPayloadReferences,
  }),
  createWhapiWebhookEventDefinition({
    providerEventType: WhapiProviderEventTypes.GROUPS_PUT,
    displayName: "Group updated",
    category: "Groups",
    payloadReferences: WhapiGroupPayloadReferences,
  }),
  createWhapiWebhookEventDefinition({
    providerEventType: WhapiProviderEventTypes.GROUPS_PATCH,
    displayName: "Group patched",
    category: "Groups",
    payloadReferences: WhapiGroupPayloadReferences,
  }),
  createWhapiWebhookEventDefinition({
    providerEventType: WhapiProviderEventTypes.PRESENCES_POST,
    displayName: "Presence changed",
    category: "Presences",
    payloadReferences: WhapiPresencePayloadReferences,
  }),
  createWhapiWebhookEventDefinition({
    providerEventType: WhapiProviderEventTypes.CHANNEL_POST,
    displayName: "Channel status changed",
    category: "Channel",
    payloadReferences: WhapiChannelPayloadReferences,
  }),
  createWhapiWebhookEventDefinition({
    providerEventType: WhapiProviderEventTypes.CHANNEL_PATCH,
    displayName: "Channel patched",
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
  createWhapiWebhookEventDefinition({
    providerEventType: WhapiProviderEventTypes.LABELS_POST,
    displayName: "Label created",
    category: "Labels",
    payloadReferences: WhapiLabelPayloadReferences,
  }),
  createWhapiWebhookEventDefinition({
    providerEventType: WhapiProviderEventTypes.LABELS_DELETE,
    displayName: "Label deleted",
    category: "Labels",
    payloadReferences: WhapiLabelPayloadReferences,
  }),
  createWhapiWebhookEventDefinition({
    providerEventType: WhapiProviderEventTypes.CALLS_POST,
    displayName: "Call received",
    category: "Calls",
    payloadReferences: WhapiCallPayloadReferences,
  }),
];
