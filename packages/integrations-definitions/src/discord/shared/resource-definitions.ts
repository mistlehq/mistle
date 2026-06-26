import {
  IntegrationResourceSelectionModes,
  type IntegrationResourceCredentialRef,
  type IntegrationResourceDefinition,
  type IntegrationResourceSyncTrigger,
} from "@mistle/integrations-core";

import {
  DiscordCredentialSecretTypes,
  DiscordCredentialSlotKeys,
} from "../variants/discord-default/auth.js";

const DiscordBotTokenResourceCredential: IntegrationResourceCredentialRef = {
  secretType: DiscordCredentialSecretTypes.API_KEY,
  slotKey: DiscordCredentialSlotKeys.BOT_TOKEN,
};

export function createDiscordResourceDefinitions(): ReadonlyArray<IntegrationResourceDefinition> {
  return [
    {
      kind: "guild",
      selectionMode: IntegrationResourceSelectionModes.MULTI,
      bindingField: "guilds",
      displayNameSingular: "guild",
      displayNamePlural: "guilds",
      description: "Discord guilds visible to this bot connection.",
      credential: DiscordBotTokenResourceCredential,
    },
    {
      kind: "channel",
      selectionMode: IntegrationResourceSelectionModes.MULTI,
      bindingField: "channels",
      displayNameSingular: "channel",
      displayNamePlural: "channels",
      description: "Discord guild channels visible to this bot connection.",
      credential: DiscordBotTokenResourceCredential,
    },
  ];
}

export const DiscordResourceSyncTriggers: ReadonlyArray<IntegrationResourceSyncTrigger> = [];
