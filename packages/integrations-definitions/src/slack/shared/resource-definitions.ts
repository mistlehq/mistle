import {
  IntegrationResourceSelectionModes,
  type IntegrationResourceSyncTrigger,
  type IntegrationResourceCredentialRef,
  type IntegrationResourceDefinition,
} from "@mistle/integrations-core";

import {
  SlackCredentialSecretTypes,
  SlackCredentialSlotKeys,
} from "../variants/slack-default/auth.js";

const SlackBotTokenResourceCredential: IntegrationResourceCredentialRef = {
  secretType: SlackCredentialSecretTypes.API_KEY,
  slotKey: SlackCredentialSlotKeys.BOT_TOKEN,
};

export function createSlackResourceDefinitions(): ReadonlyArray<IntegrationResourceDefinition> {
  return [
    {
      kind: "channel",
      selectionMode: IntegrationResourceSelectionModes.MULTI,
      bindingField: "channels",
      displayNameSingular: "channel",
      displayNamePlural: "channels",
      description: "Slack channels accessible to this connection, including private channels.",
      credential: SlackBotTokenResourceCredential,
    },
    {
      kind: "user",
      selectionMode: IntegrationResourceSelectionModes.MULTI,
      bindingField: "users",
      displayNameSingular: "user",
      displayNamePlural: "users",
      description: "Slack users accessible to this connection, including bot users.",
      credential: SlackBotTokenResourceCredential,
    },
    {
      kind: "user_group",
      selectionMode: IntegrationResourceSelectionModes.MULTI,
      bindingField: "userGroups",
      displayNameSingular: "user group",
      displayNamePlural: "user groups",
      description: "Slack user groups that can be mentioned in messages.",
      credential: SlackBotTokenResourceCredential,
    },
  ];
}

export const SlackResourceSyncTriggers: ReadonlyArray<IntegrationResourceSyncTrigger> = [
  {
    eventType: "slack:channel_created",
    resourceKinds: ["channel"],
  },
  {
    eventType: "slack:channel_archive",
    resourceKinds: ["channel"],
  },
  {
    eventType: "slack:channel_unarchive",
    resourceKinds: ["channel"],
  },
  {
    eventType: "slack:channel_rename",
    resourceKinds: ["channel"],
  },
  {
    eventType: "slack:group_archive",
    resourceKinds: ["channel"],
  },
  {
    eventType: "slack:group_unarchive",
    resourceKinds: ["channel"],
  },
  {
    eventType: "slack:group_rename",
    resourceKinds: ["channel"],
  },
  {
    eventType: "slack:team_join",
    resourceKinds: ["user"],
  },
  {
    eventType: "slack:user_change",
    resourceKinds: ["user"],
  },
  {
    eventType: "slack:subteam_created",
    resourceKinds: ["user_group"],
  },
  {
    eventType: "slack:subteam_updated",
    resourceKinds: ["user_group"],
  },
];
