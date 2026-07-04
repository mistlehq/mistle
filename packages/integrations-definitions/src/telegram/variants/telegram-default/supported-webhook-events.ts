import type {
  IntegrationWebhookEventDefinition,
  IntegrationWebhookPayloadReference,
} from "@mistle/integrations-core";

export type TelegramWebhookEventMetadata = {
  providerEventType: string;
  eventType: string;
  displayName: string;
  category: string;
  payloadReferences: readonly IntegrationWebhookPayloadReference[];
};

const TelegramBotApiDocsUrl = "https://core.telegram.org/bots/api#update";

const TelegramMessageChatProviderEventTypes = new Set<string>([
  "message",
  "edited_message",
  "channel_post",
  "edited_channel_post",
  "business_message",
  "guest_message",
  "edited_business_message",
]);

const TelegramDirectChatProviderEventTypes = new Set<string>([
  "deleted_business_messages",
  "message_reaction",
  "message_reaction_count",
  "my_chat_member",
  "chat_member",
  "chat_join_request",
  "chat_boost",
  "removed_chat_boost",
]);

const TelegramBasePayloadReferences: readonly IntegrationWebhookPayloadReference[] = [
  {
    path: ["update_id"],
    description: "Telegram update identifier.",
  },
];

function createTelegramPayloadReferences(
  providerEventType: string,
): readonly IntegrationWebhookPayloadReference[] {
  return [
    ...TelegramBasePayloadReferences,
    {
      path: [providerEventType],
      description: `Telegram ${providerEventType} update payload.`,
      allowsDescendants: true,
    },
  ];
}

function defineTelegramWebhookEvent(input: {
  providerEventType: string;
  displayName: string;
  category: string;
}): TelegramWebhookEventMetadata {
  return {
    providerEventType: input.providerEventType,
    eventType: `telegram.${input.providerEventType}`,
    displayName: input.displayName,
    category: input.category,
    payloadReferences: createTelegramPayloadReferences(input.providerEventType),
  };
}

function buildTelegramPayloadTemplate(path: readonly string[]): string {
  return `{{ payload.${path.join(".")} }}`;
}

function resolveTelegramChatPayloadPath(providerEventType: string): readonly string[] | undefined {
  if (TelegramMessageChatProviderEventTypes.has(providerEventType)) {
    return [providerEventType, "chat", "id"];
  }

  if (TelegramDirectChatProviderEventTypes.has(providerEventType)) {
    return [providerEventType, "chat", "id"];
  }

  if (providerEventType === "business_connection") {
    return [providerEventType, "user_chat_id"];
  }

  return undefined;
}

function createTelegramConversationKeyOptions(
  providerEventType: string,
): NonNullable<IntegrationWebhookEventDefinition["conversationKeyOptions"]> {
  const chatPayloadPath = resolveTelegramChatPayloadPath(providerEventType);

  return [
    {
      id: "update",
      label: "Update",
      description: "Use the Telegram update id.",
      template: buildTelegramPayloadTemplate(["update_id"]),
    },
    ...(chatPayloadPath === undefined
      ? []
      : [
          {
            id: "chat",
            label: "Chat",
            description: "Use the Telegram chat id associated with the update.",
            template: buildTelegramPayloadTemplate(chatPayloadPath),
          },
        ]),
  ];
}

// Source: Telegram Bot API Update object, https://core.telegram.org/bots/api#update
export const TelegramWebhookEventMetadata: readonly TelegramWebhookEventMetadata[] = [
  defineTelegramWebhookEvent({
    providerEventType: "message",
    displayName: "Message",
    category: "Messages",
  }),
  defineTelegramWebhookEvent({
    providerEventType: "edited_message",
    displayName: "Edited message",
    category: "Messages",
  }),
  defineTelegramWebhookEvent({
    providerEventType: "channel_post",
    displayName: "Channel post",
    category: "Channels",
  }),
  defineTelegramWebhookEvent({
    providerEventType: "edited_channel_post",
    displayName: "Edited channel post",
    category: "Channels",
  }),
  defineTelegramWebhookEvent({
    providerEventType: "business_connection",
    displayName: "Business connection",
    category: "Business",
  }),
  defineTelegramWebhookEvent({
    providerEventType: "business_message",
    displayName: "Business message",
    category: "Business",
  }),
  defineTelegramWebhookEvent({
    providerEventType: "guest_message",
    displayName: "Guest message",
    category: "Business",
  }),
  defineTelegramWebhookEvent({
    providerEventType: "edited_business_message",
    displayName: "Edited business message",
    category: "Business",
  }),
  defineTelegramWebhookEvent({
    providerEventType: "deleted_business_messages",
    displayName: "Deleted business messages",
    category: "Business",
  }),
  defineTelegramWebhookEvent({
    providerEventType: "message_reaction",
    displayName: "Message reaction",
    category: "Reactions",
  }),
  defineTelegramWebhookEvent({
    providerEventType: "message_reaction_count",
    displayName: "Message reaction count",
    category: "Reactions",
  }),
  defineTelegramWebhookEvent({
    providerEventType: "inline_query",
    displayName: "Inline query",
    category: "Queries",
  }),
  defineTelegramWebhookEvent({
    providerEventType: "chosen_inline_result",
    displayName: "Chosen inline result",
    category: "Queries",
  }),
  defineTelegramWebhookEvent({
    providerEventType: "callback_query",
    displayName: "Callback query",
    category: "Queries",
  }),
  defineTelegramWebhookEvent({
    providerEventType: "shipping_query",
    displayName: "Shipping query",
    category: "Payments",
  }),
  defineTelegramWebhookEvent({
    providerEventType: "pre_checkout_query",
    displayName: "Pre-checkout query",
    category: "Payments",
  }),
  defineTelegramWebhookEvent({
    providerEventType: "purchased_paid_media",
    displayName: "Purchased paid media",
    category: "Payments",
  }),
  defineTelegramWebhookEvent({
    providerEventType: "poll",
    displayName: "Poll",
    category: "Polls",
  }),
  defineTelegramWebhookEvent({
    providerEventType: "poll_answer",
    displayName: "Poll answer",
    category: "Polls",
  }),
  defineTelegramWebhookEvent({
    providerEventType: "my_chat_member",
    displayName: "Bot chat member status",
    category: "Chat members",
  }),
  defineTelegramWebhookEvent({
    providerEventType: "chat_member",
    displayName: "Chat member status",
    category: "Chat members",
  }),
  defineTelegramWebhookEvent({
    providerEventType: "chat_join_request",
    displayName: "Chat join request",
    category: "Chat members",
  }),
  defineTelegramWebhookEvent({
    providerEventType: "chat_boost",
    displayName: "Chat boost",
    category: "Boosts",
  }),
  defineTelegramWebhookEvent({
    providerEventType: "removed_chat_boost",
    displayName: "Removed chat boost",
    category: "Boosts",
  }),
  defineTelegramWebhookEvent({
    providerEventType: "managed_bot",
    displayName: "Managed bot",
    category: "Managed bots",
  }),
];

export const TelegramAllowedUpdates: readonly string[] = TelegramWebhookEventMetadata.map(
  (metadata) => metadata.providerEventType,
);

export const TelegramSupportedWebhookEvents: readonly IntegrationWebhookEventDefinition[] =
  TelegramWebhookEventMetadata.map((metadata) => ({
    eventType: metadata.eventType,
    providerEventType: metadata.providerEventType,
    displayName: metadata.displayName,
    category: metadata.category,
    requirements: {
      anyOf: [
        {
          event: metadata.providerEventType,
        },
      ],
    },
    payloadReferences: metadata.payloadReferences,
    conversationKeyOptions: createTelegramConversationKeyOptions(metadata.providerEventType),
  }));

export const TelegramBotApiUpdateDocsUrl = TelegramBotApiDocsUrl;
