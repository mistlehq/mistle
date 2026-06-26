import type {
  IntegrationWebhookEventDefinition,
  IntegrationWebhookEventParameterDefinition,
  IntegrationWebhookPayloadReference,
  IntegrationWebhookTriggerProviderPermissionRequirement,
} from "@mistle/integrations-core";

const DiscordPayloadReferences: readonly IntegrationWebhookPayloadReference[] = [
  {
    path: ["id"],
    description: "Discord event or interaction ID.",
  },
  {
    path: ["type"],
    description: "Discord event or interaction type.",
  },
  {
    path: ["application_id"],
    description: "Discord application ID when provided.",
  },
  {
    path: ["guild_id"],
    description: "Discord guild ID when provided.",
  },
  {
    path: ["channel_id"],
    description: "Discord channel ID when provided.",
  },
  {
    path: ["data"],
    description: "Discord event or interaction data payload.",
  },
];

const DiscordGatewayPayloadReferences: readonly IntegrationWebhookPayloadReference[] = [
  {
    path: ["t"],
    description: "Discord Gateway dispatch event type.",
  },
  {
    path: ["s"],
    description: "Discord Gateway sequence number.",
  },
  {
    path: ["d"],
    description: "Discord Gateway event data payload.",
  },
  {
    path: ["d", "guild_id"],
    description: "Discord guild ID when provided.",
  },
  {
    path: ["d", "channel_id"],
    description: "Discord channel ID when provided.",
  },
];

const DiscordGatewayConversationKeyOptions: IntegrationWebhookEventDefinition["conversationKeyOptions"] =
  [
    {
      id: "channel",
      label: "Channel",
      description: "Events from the same Discord channel go to the same conversation.",
      template: "discord:channel:{{payload.d.channel_id}}",
    },
    {
      id: "guild",
      label: "Guild",
      description: "Events from the same Discord guild go to the same conversation.",
      template: "discord:guild:{{payload.d.guild_id}}",
    },
    {
      id: "message",
      label: "Message",
      description: "Events for the same Discord message go to the same conversation.",
      template: "discord:message:{{payload.d.channel_id}}:{{payload.d.id}}",
    },
  ];

const DiscordChannelParameter: IntegrationWebhookEventParameterDefinition = {
  id: "channel",
  label: "channel",
  kind: "resource-select",
  resourceKind: "channel",
  payloadPath: ["d", "channel_id"],
  multiValue: true,
  prefix: "in",
};

const DiscordMessageAuthorParameter: IntegrationWebhookEventParameterDefinition = {
  id: "author",
  label: "author",
  kind: "string",
  payloadPath: ["d", "author", "id"],
  prefix: "from",
  placeholder: "Discord user ID",
};

const DiscordMessageContentParameter: IntegrationWebhookEventParameterDefinition = {
  id: "content",
  label: "message text",
  kind: "string",
  payloadPath: ["d", "content"],
  matchMode: "contains",
  prefix: "containing",
  placeholder: "deployment failed",
};

const DiscordReactionParameter: IntegrationWebhookEventParameterDefinition = {
  id: "reaction",
  label: "reaction",
  kind: "string",
  payloadPath: ["d", "emoji", "name"],
  prefix: "named",
  placeholder: "thumbsup",
};

const DiscordReactionActorParameter: IntegrationWebhookEventParameterDefinition = {
  id: "reactingUser",
  label: "reacting user",
  kind: "string",
  payloadPath: ["d", "user_id"],
  prefix: "by",
  placeholder: "Discord user ID",
};

export const DiscordGatewayPermissionRequirements = {
  GUILD_MESSAGES: {
    permission: "gateway_intent:GUILD_MESSAGES",
  },
  GUILD_MESSAGE_REACTIONS: {
    permission: "gateway_intent:GUILD_MESSAGE_REACTIONS",
  },
  MESSAGE_CONTENT: {
    permission: "privileged_intent:MESSAGE_CONTENT",
  },
} as const satisfies Record<string, IntegrationWebhookTriggerProviderPermissionRequirement>;

export const DiscordSupportedWebhookEvents = [
  {
    providerEventType: "application_authorized",
    eventType: "discord:application_authorized",
    displayName: "Application authorized",
    category: "Application",
    requirements: {
      anyOf: [{ event: "application_authorized" }],
    },
    payloadReferences: DiscordPayloadReferences,
  },
  {
    providerEventType: "application_deauthorized",
    eventType: "discord:application_deauthorized",
    displayName: "Application deauthorized",
    category: "Application",
    requirements: {
      anyOf: [{ event: "application_deauthorized" }],
    },
    payloadReferences: DiscordPayloadReferences,
  },
  {
    providerEventType: "entitlement_create",
    eventType: "discord:entitlement_create",
    displayName: "Entitlement created",
    category: "Entitlements",
    requirements: {
      anyOf: [{ event: "entitlement_create" }],
    },
    payloadReferences: DiscordPayloadReferences,
  },
  {
    providerEventType: "entitlement_update",
    eventType: "discord:entitlement_update",
    displayName: "Entitlement updated",
    category: "Entitlements",
    requirements: {
      anyOf: [{ event: "entitlement_update" }],
    },
    payloadReferences: DiscordPayloadReferences,
  },
  {
    providerEventType: "entitlement_delete",
    eventType: "discord:entitlement_delete",
    displayName: "Entitlement deleted",
    category: "Entitlements",
    requirements: {
      anyOf: [{ event: "entitlement_delete" }],
    },
    payloadReferences: DiscordPayloadReferences,
  },
  {
    providerEventType: "MESSAGE_CREATE",
    eventType: "discord:message_create",
    displayName: "Message created",
    category: "Gateway / Messages",
    requirements: {
      anyOf: [
        {
          event: "MESSAGE_CREATE",
          permissions: [
            DiscordGatewayPermissionRequirements.GUILD_MESSAGES,
            DiscordGatewayPermissionRequirements.MESSAGE_CONTENT,
          ],
        },
      ],
    },
    payloadReferences: DiscordGatewayPayloadReferences,
    conversationKeyOptions: DiscordGatewayConversationKeyOptions,
    parameters: [
      DiscordChannelParameter,
      DiscordMessageAuthorParameter,
      DiscordMessageContentParameter,
    ],
  },
  {
    providerEventType: "MESSAGE_UPDATE",
    eventType: "discord:message_update",
    displayName: "Message updated",
    category: "Gateway / Messages",
    requirements: {
      anyOf: [
        {
          event: "MESSAGE_UPDATE",
          permissions: [
            DiscordGatewayPermissionRequirements.GUILD_MESSAGES,
            DiscordGatewayPermissionRequirements.MESSAGE_CONTENT,
          ],
        },
      ],
    },
    payloadReferences: DiscordGatewayPayloadReferences,
    conversationKeyOptions: DiscordGatewayConversationKeyOptions,
    parameters: [
      DiscordChannelParameter,
      DiscordMessageAuthorParameter,
      DiscordMessageContentParameter,
    ],
  },
  {
    providerEventType: "MESSAGE_DELETE",
    eventType: "discord:message_delete",
    displayName: "Message deleted",
    category: "Gateway / Messages",
    requirements: {
      anyOf: [
        {
          event: "MESSAGE_DELETE",
          permissions: [DiscordGatewayPermissionRequirements.GUILD_MESSAGES],
        },
      ],
    },
    payloadReferences: DiscordGatewayPayloadReferences,
    conversationKeyOptions: DiscordGatewayConversationKeyOptions,
    parameters: [DiscordChannelParameter],
  },
  {
    providerEventType: "MESSAGE_REACTION_ADD",
    eventType: "discord:message_reaction_add",
    displayName: "Reaction added",
    category: "Gateway / Reactions",
    requirements: {
      anyOf: [
        {
          event: "MESSAGE_REACTION_ADD",
          permissions: [DiscordGatewayPermissionRequirements.GUILD_MESSAGE_REACTIONS],
        },
      ],
    },
    payloadReferences: DiscordGatewayPayloadReferences,
    conversationKeyOptions: DiscordGatewayConversationKeyOptions,
    parameters: [DiscordChannelParameter, DiscordReactionParameter, DiscordReactionActorParameter],
  },
  {
    providerEventType: "MESSAGE_REACTION_REMOVE",
    eventType: "discord:message_reaction_remove",
    displayName: "Reaction removed",
    category: "Gateway / Reactions",
    requirements: {
      anyOf: [
        {
          event: "MESSAGE_REACTION_REMOVE",
          permissions: [DiscordGatewayPermissionRequirements.GUILD_MESSAGE_REACTIONS],
        },
      ],
    },
    payloadReferences: DiscordGatewayPayloadReferences,
    conversationKeyOptions: DiscordGatewayConversationKeyOptions,
    parameters: [DiscordChannelParameter, DiscordReactionParameter, DiscordReactionActorParameter],
  },
] satisfies readonly IntegrationWebhookEventDefinition[];
