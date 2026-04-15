import {
  IntegrationResourceSelectionModes,
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
      description: "Public Slack channels accessible to this connection.",
      credential: SlackBotTokenResourceCredential,
    },
  ];
}
