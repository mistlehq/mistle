import { buildUrlWithPath } from "@mistle/http";
import type { IntegrationConnectionRepairCapability } from "@mistle/integrations-core";
import { z } from "zod";

import {
  SlackConnectionConfigSchema,
  SlackConnectionMethodId,
  SlackCredentialSecretTypes,
  SlackCredentialSlotKeys,
  type SlackConnectionConfig,
} from "./auth.js";
import type { SlackTargetConfig } from "./target-config-schema.js";
import type { SlackTargetSecrets } from "./target-secret-schema.js";

const SlackAuthTestResponseSchema = z.looseObject({
  ok: z.boolean(),
  error: z.string().min(1).optional(),
  user_id: z.string().min(1).optional(),
});

type SlackConnectionRepairCapabilityType = IntegrationConnectionRepairCapability<
  SlackTargetConfig,
  SlackTargetSecrets,
  SlackConnectionConfig
>;

function needsSlackBotIdentityRepair(config: SlackConnectionConfig): boolean {
  return (
    config.connection_method === SlackConnectionMethodId &&
    (config.bot_user_id === undefined || config.bot_user_id.trim().length === 0)
  );
}

async function resolveSlackBotUserId(input: {
  apiBaseUrl: string;
  botToken: string;
}): Promise<string> {
  // Slack documents auth.test as scope-free and returning user_id/bot_id for
  // the authenticated token: https://api.slack.com/methods/auth.test
  const response = await fetch(buildUrlWithPath(input.apiBaseUrl, "/auth.test"), {
    method: "POST",
    headers: {
      authorization: `Bearer ${input.botToken}`,
      accept: "application/json",
    },
  });

  if (!response.ok) {
    throw new Error(`Slack auth.test request failed with status ${String(response.status)}.`);
  }

  const payload = SlackAuthTestResponseSchema.parse(await response.json());
  if (!payload.ok) {
    throw new Error(
      payload.error === undefined
        ? "Slack auth.test returned an error."
        : `Slack auth.test returned an error: ${payload.error}.`,
    );
  }

  if (payload.user_id === undefined || payload.user_id.trim().length === 0) {
    throw new Error("Slack auth.test did not return a bot user id.");
  }

  return payload.user_id;
}

export const SlackConnectionRepairCapability: SlackConnectionRepairCapabilityType = {
  describeRepair(input) {
    const parsedConfig = SlackConnectionConfigSchema.safeParse(input.connection.config);
    if (!parsedConfig.success || !needsSlackBotIdentityRepair(parsedConfig.data)) {
      return null;
    }

    return {
      id: "slack-bot-identity",
      title: "Slack bot identity missing",
      description:
        "This connection needs its Slack bot identity before Slack thread routing can be enabled.",
      actionLabel: "Fix Slack bot identity",
      pendingLabel: "Fixing...",
    };
  },
  async repair(input) {
    if (!needsSlackBotIdentityRepair(input.connection.config)) {
      return {};
    }

    const botToken = await input.resolveConnectionSecret({
      slotKey: SlackCredentialSlotKeys.BOT_TOKEN,
      secretType: SlackCredentialSecretTypes.API_KEY,
    });
    if (botToken === undefined || botToken.trim().length === 0) {
      throw new Error("Slack bot token is missing. Reconnect this integration.");
    }

    const botUserId = await resolveSlackBotUserId({
      apiBaseUrl: input.target.config.apiBaseUrl,
      botToken: botToken.trim(),
    });

    return {
      config: {
        ...input.connection.config,
        bot_user_id: botUserId,
      },
    };
  },
};
