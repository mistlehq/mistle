import type {
  IntegrationWebhookEventDefinition,
  IntegrationWebhookPayloadReference,
} from "@mistle/integrations-core";

type WasenderApiWebhookEventMetadata = {
  providerEventType: string;
  displayName: string;
  category: string;
  docsUrl: string;
  payloadReferences: readonly IntegrationWebhookPayloadReference[];
  conversationKeyOptions?: IntegrationWebhookEventDefinition["conversationKeyOptions"];
};

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

const WasenderApiMessageKeyPayloadReferences: readonly IntegrationWebhookPayloadReference[] = [
  ...WasenderApiPayloadReferences,
  {
    path: ["data", "key", "id"],
    description: "WasenderAPI message ID.",
  },
  {
    path: ["data", "key", "remoteJid"],
    description: "WhatsApp remote JID for the message.",
  },
  {
    path: ["data", "message"],
    description: "WasenderAPI message payload.",
  },
];

const WasenderApiMessageDeletePayloadReferences: readonly IntegrationWebhookPayloadReference[] = [
  ...WasenderApiPayloadReferences,
  {
    path: ["data", "keys"],
    description: "WasenderAPI deleted message keys.",
  },
  {
    path: ["data", "keys", "0", "id"],
    description: "First deleted message ID when a key list is provided.",
  },
  {
    path: ["data", "keys", "0", "remoteJid"],
    description: "First WhatsApp remote JID when a key list is provided.",
  },
];

const WasenderApiMessageReceiptPayloadReferences: readonly IntegrationWebhookPayloadReference[] = [
  ...WasenderApiPayloadReferences,
  {
    path: ["data", "message", "key", "id"],
    description: "WasenderAPI message ID for the receipt update.",
  },
  {
    path: ["data", "message", "key", "remoteJid"],
    description: "WhatsApp remote JID for the receipt update.",
  },
  {
    path: ["data", "message", "receipt"],
    description: "WasenderAPI message receipt payload.",
  },
];

const WasenderApiMessageReactionPayloadReferences: readonly IntegrationWebhookPayloadReference[] = [
  ...WasenderApiPayloadReferences,
  {
    path: ["data", "0", "key", "id"],
    description: "WasenderAPI message ID for the first reaction update.",
  },
  {
    path: ["data", "0", "key", "remoteJid"],
    description: "WhatsApp remote JID for the first reaction update.",
  },
  {
    path: ["data", "0", "reaction"],
    description: "WasenderAPI reaction payload.",
  },
];

const WasenderApiPollPayloadReferences: readonly IntegrationWebhookPayloadReference[] = [
  ...WasenderApiPayloadReferences,
  {
    path: ["data", "key", "id"],
    description: "WasenderAPI poll message ID.",
  },
  {
    path: ["data", "key", "remoteJid"],
    description: "WhatsApp remote JID for the poll.",
  },
  {
    path: ["data", "pollResult"],
    description: "WasenderAPI poll results.",
  },
];

const WasenderApiSessionPayloadReferences: readonly IntegrationWebhookPayloadReference[] = [
  ...WasenderApiPayloadReferences,
  {
    path: ["data", "status"],
    description: "WasenderAPI session status.",
  },
  {
    path: ["data", "qr"],
    description: "WasenderAPI QR code string when provided.",
  },
];

const WasenderApiCallPayloadReferences: readonly IntegrationWebhookPayloadReference[] = [
  ...WasenderApiPayloadReferences,
  {
    path: ["data", "id"],
    description: "WasenderAPI call ID.",
  },
  {
    path: ["data", "from"],
    description: "WhatsApp caller JID.",
  },
];

const WasenderApiChatPayloadReferences: readonly IntegrationWebhookPayloadReference[] = [
  ...WasenderApiPayloadReferences,
  {
    path: ["data"],
    description: "WasenderAPI chat payload or chat payload list.",
  },
  {
    path: ["data", "0", "id"],
    description: "First chat ID when a chat list is provided.",
  },
];

const WasenderApiGroupPayloadReferences: readonly IntegrationWebhookPayloadReference[] = [
  ...WasenderApiPayloadReferences,
  {
    path: ["data"],
    description: "WasenderAPI group payload or group payload list.",
  },
  {
    path: ["data", "0", "jid"],
    description: "First group JID when a group list is provided.",
  },
];

const WasenderApiGroupParticipantsPayloadReferences: readonly IntegrationWebhookPayloadReference[] =
  [
    ...WasenderApiPayloadReferences,
    {
      path: ["data", "jid"],
      description: "WasenderAPI group JID.",
    },
    {
      path: ["data", "participants"],
      description: "WasenderAPI participant JIDs affected by the update.",
    },
    {
      path: ["data", "action"],
      description: "WasenderAPI group participant action.",
    },
  ];

const WasenderApiContactPayloadReferences: readonly IntegrationWebhookPayloadReference[] = [
  ...WasenderApiPayloadReferences,
  {
    path: ["data"],
    description: "WasenderAPI contact payload or contact payload list.",
  },
  {
    path: ["data", "0", "jid"],
    description: "First contact JID when a contact list is provided.",
  },
];

function createWasenderApiMessageConversationKeyTemplate(input: {
  scope: "chat" | "message";
  field: "id" | "remoteJid";
}): string {
  return `wasenderapi:${input.scope}:{% if payload.data.messages.key %}{{payload.data.messages.key.${input.field}}}{% else %}{{payload.data.messages[0].key.${input.field}}}{% endif %}`;
}

function createWasenderApiDataKeyConversationKeyTemplate(input: {
  scope: "chat" | "message";
  field: "id" | "remoteJid";
}): string {
  return `wasenderapi:${input.scope}:{{payload.data.key.${input.field}}}`;
}

function createWasenderApiMessageReceiptConversationKeyTemplate(input: {
  scope: "chat" | "message";
  field: "id" | "remoteJid";
}): string {
  return `wasenderapi:${input.scope}:{{payload.data.message.key.${input.field}}}`;
}

function createWasenderApiFirstArrayKeyConversationKeyTemplate(input: {
  scope: "chat" | "message";
  field: "id" | "remoteJid";
}): string {
  return `wasenderapi:${input.scope}:{{payload.data[0].key.${input.field}}}`;
}

function createWasenderApiEventConversationKeyTemplate(providerEventType: string): string {
  return `wasenderapi:event:${providerEventType}:{% if payload.sessionId %}{{payload.sessionId}}{% else %}source{% endif %}`;
}

const WasenderApiMessageConversationKeyOptions: IntegrationWebhookEventDefinition["conversationKeyOptions"] =
  [
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

const WasenderApiDataKeyConversationKeyOptions: IntegrationWebhookEventDefinition["conversationKeyOptions"] =
  [
    {
      id: "remote-jid",
      label: "Chat",
      description: "Events from the same WhatsApp chat go to the same conversation.",
      template: createWasenderApiDataKeyConversationKeyTemplate({
        scope: "chat",
        field: "remoteJid",
      }),
    },
    {
      id: "message",
      label: "Message",
      description: "Events for the same WasenderAPI message go to the same conversation.",
      template: createWasenderApiDataKeyConversationKeyTemplate({
        scope: "message",
        field: "id",
      }),
    },
  ];

const WasenderApiMessageReceiptConversationKeyOptions: IntegrationWebhookEventDefinition["conversationKeyOptions"] =
  [
    {
      id: "remote-jid",
      label: "Chat",
      description: "Receipt updates from the same WhatsApp chat go to the same conversation.",
      template: createWasenderApiMessageReceiptConversationKeyTemplate({
        scope: "chat",
        field: "remoteJid",
      }),
    },
    {
      id: "message",
      label: "Message",
      description: "Receipt updates for the same WasenderAPI message go to the same conversation.",
      template: createWasenderApiMessageReceiptConversationKeyTemplate({
        scope: "message",
        field: "id",
      }),
    },
  ];

const WasenderApiMessageReactionConversationKeyOptions: IntegrationWebhookEventDefinition["conversationKeyOptions"] =
  [
    {
      id: "remote-jid",
      label: "Chat",
      description: "Reaction updates from the same WhatsApp chat go to the same conversation.",
      template: createWasenderApiFirstArrayKeyConversationKeyTemplate({
        scope: "chat",
        field: "remoteJid",
      }),
    },
    {
      id: "message",
      label: "Message",
      description: "Reaction updates for the same WasenderAPI message go to the same conversation.",
      template: createWasenderApiFirstArrayKeyConversationKeyTemplate({
        scope: "message",
        field: "id",
      }),
    },
  ];

function createWasenderApiEventConversationKeyOptions(
  providerEventType: string,
): IntegrationWebhookEventDefinition["conversationKeyOptions"] {
  return [
    {
      id: "event",
      label: "Event",
      description: "Events of this WasenderAPI type go to the same conversation.",
      template: createWasenderApiEventConversationKeyTemplate(providerEventType),
    },
  ];
}

const WasenderApiSessionConversationKeyOptions: IntegrationWebhookEventDefinition["conversationKeyOptions"] =
  [
    {
      id: "session",
      label: "Session",
      description: "Session events from the same WasenderAPI session go to the same conversation.",
      template: "wasenderapi:session:{{payload.sessionId}}",
    },
  ];

const WasenderApiCallConversationKeyOptions: IntegrationWebhookEventDefinition["conversationKeyOptions"] =
  [
    {
      id: "caller",
      label: "Caller",
      description: "Calls from the same WhatsApp caller go to the same conversation.",
      template: "wasenderapi:caller:{{payload.data.from}}",
    },
    {
      id: "call",
      label: "Call",
      description: "Events for the same WasenderAPI call go to the same conversation.",
      template: "wasenderapi:call:{{payload.data.id}}",
    },
  ];

const WasenderApiGroupParticipantsConversationKeyOptions: IntegrationWebhookEventDefinition["conversationKeyOptions"] =
  [
    {
      id: "group",
      label: "Group",
      description:
        "Group participant updates from the same WhatsApp group go to the same conversation.",
      template: "wasenderapi:group:{{payload.data.jid}}",
    },
  ];

// Source: WasenderAPI webhook documentation under https://wasenderapi.com/api-docs/webhooks.
// Keep this table aligned with the Wasender dashboard event list.
export const WasenderApiWebhookEventMetadata: readonly WasenderApiWebhookEventMetadata[] = [
  {
    providerEventType: "messages.received",
    displayName: "Message received",
    category: "Messages",
    docsUrl: "https://wasenderapi.com/api-docs/webhooks/webhook-message-received",
    payloadReferences: WasenderApiMessagePayloadReferences,
    conversationKeyOptions: WasenderApiMessageConversationKeyOptions,
  },
  {
    providerEventType: "messages.upsert",
    displayName: "Message upsert",
    category: "Messages",
    docsUrl: "https://wasenderapi.com/api-docs/webhooks/webhook-message-upsert",
    payloadReferences: WasenderApiMessagePayloadReferences,
    conversationKeyOptions: WasenderApiMessageConversationKeyOptions,
  },
  {
    providerEventType: "messages-personal.received",
    displayName: "Personal message received",
    category: "Messages",
    docsUrl: "https://www.wasenderapi.com/api-docs/webhooks/webhook-personal-message-received",
    payloadReferences: WasenderApiMessagePayloadReferences,
    conversationKeyOptions: WasenderApiMessageConversationKeyOptions,
  },
  {
    providerEventType: "messages-group.received",
    displayName: "Group message received",
    category: "Messages",
    docsUrl: "https://wasenderapi.com/api-docs/webhooks/webhook-group-message-received",
    payloadReferences: WasenderApiMessagePayloadReferences,
    conversationKeyOptions: WasenderApiMessageConversationKeyOptions,
  },
  {
    providerEventType: "messages-newsletter.received",
    displayName: "Newsletter message received",
    category: "Messages",
    docsUrl: "https://www.wasenderapi.com/api-docs/webhooks/webhook-newsletter-message-received",
    payloadReferences: WasenderApiMessagePayloadReferences,
    conversationKeyOptions: WasenderApiMessageConversationKeyOptions,
  },
  {
    providerEventType: "message.sent",
    displayName: "Message sent",
    category: "Messages",
    docsUrl: "https://wasenderapi.com/api-docs/webhooks/webhook-message-sent",
    payloadReferences: WasenderApiMessageKeyPayloadReferences,
    conversationKeyOptions: WasenderApiDataKeyConversationKeyOptions,
  },
  {
    providerEventType: "messages.update",
    displayName: "Message status update",
    category: "Messages",
    docsUrl: "https://wasenderapi.com/api-docs/webhooks/webhook-message-update",
    payloadReferences: WasenderApiMessageKeyPayloadReferences,
    conversationKeyOptions: WasenderApiDataKeyConversationKeyOptions,
  },
  {
    providerEventType: "messages.delete",
    displayName: "Message deleted",
    category: "Messages",
    docsUrl: "https://wasenderapi.com/api-docs/webhooks/webhook-message-deleted",
    payloadReferences: WasenderApiMessageDeletePayloadReferences,
    conversationKeyOptions: createWasenderApiEventConversationKeyOptions("messages.delete"),
  },
  {
    providerEventType: "message-receipt.update",
    displayName: "Message receipt update",
    category: "Messages",
    docsUrl: "https://wasenderapi.com/api-docs/webhooks/webhook-message-receipt-update",
    payloadReferences: WasenderApiMessageReceiptPayloadReferences,
    conversationKeyOptions: WasenderApiMessageReceiptConversationKeyOptions,
  },
  {
    providerEventType: "messages.reaction",
    displayName: "Message reaction",
    category: "Messages",
    docsUrl: "https://wasenderapi.com/api-docs/webhooks/webhook-message-reaction",
    payloadReferences: WasenderApiMessageReactionPayloadReferences,
    conversationKeyOptions: WasenderApiMessageReactionConversationKeyOptions,
  },
  {
    providerEventType: "call",
    displayName: "Call received",
    category: "Calls",
    docsUrl: "https://www.wasenderapi.com/api-docs/webhooks/webhook-call-received",
    payloadReferences: WasenderApiCallPayloadReferences,
    conversationKeyOptions: WasenderApiCallConversationKeyOptions,
  },
  {
    providerEventType: "session.status",
    displayName: "Session status",
    category: "Sessions",
    docsUrl: "https://wasenderapi.com/api-docs/webhooks/webhook-session-status",
    payloadReferences: WasenderApiSessionPayloadReferences,
    conversationKeyOptions: WasenderApiSessionConversationKeyOptions,
  },
  {
    providerEventType: "qrcode.updated",
    displayName: "QR code updated",
    category: "Sessions",
    docsUrl: "https://wasenderapi.com/api-docs/webhooks/webhook-qrcode-updated",
    payloadReferences: WasenderApiSessionPayloadReferences,
    conversationKeyOptions: WasenderApiSessionConversationKeyOptions,
  },
  {
    providerEventType: "chats.upsert",
    displayName: "Chat upsert",
    category: "Chats",
    docsUrl: "https://www.wasenderapi.com/api-docs/webhooks/webhook-chat-upsert",
    payloadReferences: WasenderApiChatPayloadReferences,
    conversationKeyOptions: createWasenderApiEventConversationKeyOptions("chats.upsert"),
  },
  {
    providerEventType: "chats.update",
    displayName: "Chat update",
    category: "Chats",
    docsUrl: "https://wasenderapi.com/api-docs/webhooks/webhook-chat-update",
    payloadReferences: WasenderApiChatPayloadReferences,
    conversationKeyOptions: createWasenderApiEventConversationKeyOptions("chats.update"),
  },
  {
    providerEventType: "chats.delete",
    displayName: "Chat deleted",
    category: "Chats",
    docsUrl: "https://www.wasenderapi.com/api-docs/webhooks/webhook-chat-delete",
    payloadReferences: WasenderApiChatPayloadReferences,
    conversationKeyOptions: createWasenderApiEventConversationKeyOptions("chats.delete"),
  },
  {
    providerEventType: "groups.upsert",
    displayName: "Group upsert",
    category: "Groups",
    docsUrl: "https://www.wasenderapi.com/api-docs/webhooks/webhook-group-upsert",
    payloadReferences: WasenderApiGroupPayloadReferences,
    conversationKeyOptions: createWasenderApiEventConversationKeyOptions("groups.upsert"),
  },
  {
    providerEventType: "groups.update",
    displayName: "Group update",
    category: "Groups",
    docsUrl: "https://wasenderapi.com/api-docs/webhooks/webhook-group-update",
    payloadReferences: WasenderApiGroupPayloadReferences,
    conversationKeyOptions: createWasenderApiEventConversationKeyOptions("groups.update"),
  },
  {
    providerEventType: "group-participants.update",
    displayName: "Group participants update",
    category: "Groups",
    docsUrl: "https://www.wasenderapi.com/api-docs/webhooks/webhook-group-participants-update",
    payloadReferences: WasenderApiGroupParticipantsPayloadReferences,
    conversationKeyOptions: WasenderApiGroupParticipantsConversationKeyOptions,
  },
  {
    providerEventType: "contacts.upsert",
    displayName: "Contact upsert",
    category: "Contacts",
    docsUrl: "https://www.wasenderapi.com/api-docs/webhooks/webhook-contact-upsert",
    payloadReferences: WasenderApiContactPayloadReferences,
    conversationKeyOptions: createWasenderApiEventConversationKeyOptions("contacts.upsert"),
  },
  {
    providerEventType: "contacts.update",
    displayName: "Contact update",
    category: "Contacts",
    docsUrl: "https://www.wasenderapi.com/api-docs/webhooks/webhook-contact-update",
    payloadReferences: WasenderApiContactPayloadReferences,
    conversationKeyOptions: createWasenderApiEventConversationKeyOptions("contacts.update"),
  },
  {
    providerEventType: "poll.results",
    displayName: "Poll results",
    category: "Polls",
    docsUrl: "https://www.wasenderapi.com/api-docs/webhooks/webhook-poll-results",
    payloadReferences: WasenderApiPollPayloadReferences,
    conversationKeyOptions: WasenderApiDataKeyConversationKeyOptions,
  },
];

function createWasenderApiWebhookEventDefinition(
  input: WasenderApiWebhookEventMetadata,
): IntegrationWebhookEventDefinition {
  return {
    eventType: `wasenderapi.${input.providerEventType}`,
    providerEventType: input.providerEventType,
    displayName: input.displayName,
    category: input.category,
    payloadReferences: input.payloadReferences,
    ...(input.conversationKeyOptions === undefined
      ? {}
      : { conversationKeyOptions: input.conversationKeyOptions }),
  };
}

export const WasenderApiSupportedWebhookEvents: readonly IntegrationWebhookEventDefinition[] =
  WasenderApiWebhookEventMetadata.map((metadata) =>
    createWasenderApiWebhookEventDefinition(metadata),
  );
