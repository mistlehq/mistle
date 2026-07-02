import {
  IntegrationWebhookSourceLifecycles,
  type IntegrationFormConnectionMethodCreateValidationInput,
  type IntegrationWebhookSourceCapability,
} from "@mistle/integrations-core";
import { z } from "zod";

import { buildIntegrationWebhookCallbackUrl } from "../../../shared/webhook-callback-url.server.js";
import { TelegramConnectionConfigSchema, type TelegramConnectionConfig } from "./auth.js";
import { TelegramAllowedUpdates } from "./supported-webhook-events.js";
import type { TelegramTargetConfig } from "./target-config-schema.js";

const TelegramApiSuccessBaseSchema = z
  .object({
    ok: z.literal(true),
  })
  .loose();
const TelegramApiErrorSchema = z
  .object({
    ok: z.literal(false),
    description: z.string().min(1).optional(),
    error_code: z.number().int().optional(),
  })
  .loose();
const TelegramWebhookInfoResponseSchema = z.union([
  TelegramApiSuccessBaseSchema.extend({
    result: z
      .object({
        url: z.string(),
      })
      .loose(),
  }),
  TelegramApiErrorSchema,
]);
const TelegramBooleanResponseSchema = z.union([
  TelegramApiSuccessBaseSchema.extend({
    result: z.literal(true),
  }),
  TelegramApiErrorSchema,
]);

type TelegramConnectionSecrets = {
  botToken?: string;
};

function resolveTelegramBotToken(input: {
  connectionId?: string | undefined;
  connectionSecrets: TelegramConnectionSecrets | Record<string, string> | undefined;
}): string {
  const botToken = input.connectionSecrets?.botToken?.trim();
  if (botToken === undefined || botToken.length === 0) {
    throw new Error(
      input.connectionId === undefined
        ? "Telegram bot token is missing."
        : `Integration connection '${input.connectionId}' is missing Telegram bot token.`,
    );
  }

  return botToken;
}

function buildTelegramMethodUrl(input: {
  apiBaseUrl: string;
  botToken: string;
  method: string;
}): string {
  const apiBaseUrl = input.apiBaseUrl.endsWith("/")
    ? input.apiBaseUrl.slice(0, -1)
    : input.apiBaseUrl;

  return `${apiBaseUrl}/bot${input.botToken}/${input.method}`;
}

function formatTelegramApiError(input: z.output<typeof TelegramApiErrorSchema>): string {
  const description = input.description ?? "Telegram Bot API request failed.";
  if (input.error_code === undefined) {
    return description;
  }

  return `${description} (${input.error_code.toString()})`;
}

async function readTelegramJsonResponse(response: Response): Promise<unknown> {
  const responseText = await response.text();
  try {
    return JSON.parse(responseText);
  } catch {
    throw new Error("Telegram Bot API response must be valid JSON.");
  }
}

async function getTelegramWebhookUrl(input: {
  apiBaseUrl: string;
  botToken: string;
}): Promise<string> {
  const response = await fetch(
    buildTelegramMethodUrl({
      apiBaseUrl: input.apiBaseUrl,
      botToken: input.botToken,
      method: "getWebhookInfo",
    }),
    {
      method: "POST",
      headers: {
        accept: "application/json",
      },
    },
  );
  const parsedResponse = TelegramWebhookInfoResponseSchema.parse(
    await readTelegramJsonResponse(response),
  );

  if (!parsedResponse.ok) {
    throw new Error(`Telegram getWebhookInfo failed: ${formatTelegramApiError(parsedResponse)}`);
  }

  return parsedResponse.result.url.trim();
}

async function setTelegramWebhook(input: {
  apiBaseUrl: string;
  botToken: string;
  callbackUrl: string;
  webhookSecret: string;
}): Promise<void> {
  const response = await fetch(
    buildTelegramMethodUrl({
      apiBaseUrl: input.apiBaseUrl,
      botToken: input.botToken,
      method: "setWebhook",
    }),
    {
      method: "POST",
      headers: {
        accept: "application/json",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        url: input.callbackUrl,
        secret_token: input.webhookSecret,
        allowed_updates: [...TelegramAllowedUpdates],
      }),
    },
  );
  const parsedResponse = TelegramBooleanResponseSchema.parse(
    await readTelegramJsonResponse(response),
  );
  if (!parsedResponse.ok) {
    throw new Error(`Telegram setWebhook failed: ${formatTelegramApiError(parsedResponse)}`);
  }
}

async function deleteTelegramWebhook(input: {
  apiBaseUrl: string;
  botToken: string;
}): Promise<void> {
  const response = await fetch(
    buildTelegramMethodUrl({
      apiBaseUrl: input.apiBaseUrl,
      botToken: input.botToken,
      method: "deleteWebhook",
    }),
    {
      method: "POST",
      headers: {
        accept: "application/json",
      },
    },
  );
  const parsedResponse = TelegramBooleanResponseSchema.parse(
    await readTelegramJsonResponse(response),
  );
  if (!parsedResponse.ok) {
    throw new Error(`Telegram deleteWebhook failed: ${formatTelegramApiError(parsedResponse)}`);
  }
}

function buildTelegramCallbackUrl(input: {
  controlPlaneBaseUrl: string;
  targetKey: string;
  endpointKey: string;
}): string {
  return buildIntegrationWebhookCallbackUrl(input);
}

async function assertTelegramWebhookIsAvailable(input: {
  apiBaseUrl: string;
  botToken: string;
  expectedCallbackUrl?: string | undefined;
}): Promise<void> {
  const existingWebhookUrl = await getTelegramWebhookUrl({
    apiBaseUrl: input.apiBaseUrl,
    botToken: input.botToken,
  });
  if (existingWebhookUrl.length === 0 || existingWebhookUrl === input.expectedCallbackUrl) {
    return;
  }

  throw new Error(
    `Telegram bot already has a webhook registered at '${existingWebhookUrl}'. Remove it before connecting this bot to Mistle.`,
  );
}

export async function validateTelegramFormConnectionCreate(
  input: IntegrationFormConnectionMethodCreateValidationInput<
    TelegramTargetConfig,
    Record<string, never>,
    TelegramConnectionConfig
  >,
): Promise<void> {
  TelegramConnectionConfigSchema.parse(input.config);
  await assertTelegramWebhookIsAvailable({
    apiBaseUrl: input.target.config.apiBaseUrl,
    botToken: resolveTelegramBotToken({ connectionSecrets: input.secrets }),
  });
}

export const TelegramWebhookSourceCapability: IntegrationWebhookSourceCapability<
  TelegramTargetConfig,
  Record<string, never>,
  TelegramConnectionConfig
> = {
  lifecycle: IntegrationWebhookSourceLifecycles.MANAGED,
  supportsConnection(input) {
    return TelegramConnectionConfigSchema.safeParse(input.connection.config).success;
  },
  async describeSource(input) {
    const endpointKey = input.source.endpointKey;
    if (endpointKey === undefined) {
      throw new Error(`Telegram webhook source '${input.source.id}' is missing endpointKey.`);
    }

    return {
      displayName: input.source.displayName ?? "Telegram webhook",
      callbackUrl: buildTelegramCallbackUrl({
        controlPlaneBaseUrl: input.controlPlaneBaseUrl,
        targetKey: input.targetKey,
        endpointKey,
      }),
      providerMetadata: input.source.providerMetadata,
    };
  },
  async createRegistration(input) {
    const endpointKey = input.source.endpointKey;
    if (endpointKey === undefined) {
      throw new Error(`Telegram webhook source '${input.source.id}' is missing endpointKey.`);
    }
    const webhookSecret = input.webhookSecret;
    if (webhookSecret === undefined || webhookSecret.trim().length === 0) {
      throw new Error("Telegram webhook registration requires a webhook secret.");
    }

    const botToken = resolveTelegramBotToken({
      connectionId: input.connection.id,
      connectionSecrets: input.connectionSecrets,
    });
    const callbackUrl = buildTelegramCallbackUrl({
      controlPlaneBaseUrl: input.controlPlaneBaseUrl,
      targetKey: input.targetKey,
      endpointKey,
    });
    await assertTelegramWebhookIsAvailable({
      apiBaseUrl: input.target.config.apiBaseUrl,
      botToken,
      expectedCallbackUrl: callbackUrl,
    });
    await setTelegramWebhook({
      apiBaseUrl: input.target.config.apiBaseUrl,
      botToken,
      callbackUrl,
      webhookSecret,
    });

    return {
      remoteRegistrationId: callbackUrl,
      providerMetadata: {
        allowedUpdates: [...TelegramAllowedUpdates],
      },
    };
  },
  async deleteRegistration(input) {
    const endpointKey = input.source.endpointKey;
    if (endpointKey === undefined) {
      throw new Error(`Telegram webhook source '${input.source.id}' is missing endpointKey.`);
    }

    const botToken = resolveTelegramBotToken({
      connectionId: input.connection.id,
      connectionSecrets: input.connectionSecrets,
    });
    const callbackUrl = buildTelegramCallbackUrl({
      controlPlaneBaseUrl: input.controlPlaneBaseUrl,
      targetKey: input.targetKey,
      endpointKey,
    });
    const existingWebhookUrl = await getTelegramWebhookUrl({
      apiBaseUrl: input.target.config.apiBaseUrl,
      botToken,
    });
    if (existingWebhookUrl.length === 0 || existingWebhookUrl !== callbackUrl) {
      return;
    }

    await deleteTelegramWebhook({
      apiBaseUrl: input.target.config.apiBaseUrl,
      botToken,
    });
  },
};
