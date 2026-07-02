import { timingSafeEqual } from "node:crypto";

import {
  IntegrationWebhookError,
  type IntegrationConnection,
  type IntegrationWebhookEvent,
  type IntegrationWebhookHandler,
  type IntegrationWebhookResolveConnectionResult,
  type IntegrationWebhookVerifyResult,
  WebhookErrorCodes,
} from "@mistle/integrations-core";
import { z } from "zod";

import { TelegramWebhookEventMetadata } from "./supported-webhook-events.js";
import type { TelegramTargetConfig } from "./target-config-schema.js";

const TelegramSecretTokenHeaderName = "x-telegram-bot-api-secret-token";

const TelegramUpdateSchema = z
  .object({
    update_id: z.number().int().nonnegative(),
  })
  .catchall(z.unknown());

type TelegramConnectionSecrets = {
  webhookSecret?: string;
};

function createInvalidTelegramWebhookRequestError(message: string): IntegrationWebhookError {
  return new IntegrationWebhookError(WebhookErrorCodes.WEBHOOK_REQUEST_INVALID, message);
}

function parseTelegramJsonPayload(input: Uint8Array): Record<string, unknown> {
  const decodedBody = new TextDecoder().decode(input);
  let parsedPayload: unknown;

  try {
    parsedPayload = JSON.parse(decodedBody);
  } catch {
    throw createInvalidTelegramWebhookRequestError("Telegram webhook payload must be valid JSON.");
  }

  const parseResult = TelegramUpdateSchema.safeParse(parsedPayload);
  if (!parseResult.success) {
    throw createInvalidTelegramWebhookRequestError(
      "Telegram webhook payload must be a Telegram Update object.",
    );
  }

  return parseResult.data;
}

function resolveTelegramProviderEventType(payload: Readonly<Record<string, unknown>>): string {
  const matchedEventTypes = TelegramWebhookEventMetadata.filter(
    (metadata) => payload[metadata.providerEventType] !== undefined,
  ).map((metadata) => metadata.providerEventType);

  if (matchedEventTypes.length === 0) {
    throw createInvalidTelegramWebhookRequestError(
      "Telegram webhook payload does not contain a supported update field.",
    );
  }

  if (matchedEventTypes.length > 1) {
    throw createInvalidTelegramWebhookRequestError(
      `Telegram webhook payload contains multiple update fields: ${matchedEventTypes.join(", ")}.`,
    );
  }

  const providerEventType = matchedEventTypes[0];
  if (providerEventType === undefined) {
    throw new Error("Expected Telegram provider event type.");
  }

  return providerEventType;
}

function resolveTelegramEvent(input: {
  payload: Readonly<Record<string, unknown>>;
  providerEventType: string;
}): IntegrationWebhookEvent {
  const metadata = TelegramWebhookEventMetadata.find(
    (candidate) => candidate.providerEventType === input.providerEventType,
  );
  if (metadata === undefined) {
    throw createInvalidTelegramWebhookRequestError(
      `Telegram webhook event '${input.providerEventType}' is not supported.`,
    );
  }

  const updateId = input.payload["update_id"];
  if (typeof updateId !== "number" || !Number.isInteger(updateId) || updateId < 0) {
    throw createInvalidTelegramWebhookRequestError(
      "Telegram webhook payload is missing update_id.",
    );
  }
  const updateIdText = updateId.toString();

  return {
    externalEventId: updateIdText,
    externalDeliveryId: updateIdText,
    providerEventType: input.providerEventType,
    eventType: metadata.eventType,
    payload: input.payload,
    sourceOrderKey: updateIdText,
  };
}

function resolvePathRoutedConnection(
  candidates: ReadonlyArray<IntegrationConnection>,
): IntegrationWebhookResolveConnectionResult {
  const candidate = candidates[0];
  if (candidate === undefined) {
    return {
      ok: false,
      code: "connection-not-found",
      message: "No active Telegram connection matched the webhook source.",
    };
  }

  if (candidates.length > 1) {
    return {
      ok: false,
      code: "connection-ambiguous",
      message: "Multiple active Telegram connections matched the webhook source.",
    };
  }

  return {
    ok: true,
    connectionId: candidate.id,
  };
}

function resolveHeader(input: Readonly<Record<string, string>>, headerName: string): string {
  const value = input[headerName];
  if (value === undefined || value.trim().length === 0) {
    throw new Error(`Telegram webhook is missing ${headerName} header.`);
  }

  return value.trim();
}

export function verifyTelegramWebhookSecret(input: {
  webhookSecret: string;
  secretToken: string;
}): IntegrationWebhookVerifyResult {
  const expectedBytes = Buffer.from(input.webhookSecret);
  const actualBytes = Buffer.from(input.secretToken);
  if (expectedBytes.length !== actualBytes.length || !timingSafeEqual(expectedBytes, actualBytes)) {
    return {
      ok: false,
      code: "invalid-signature",
      message: "Telegram webhook secret verification failed.",
    };
  }

  return { ok: true };
}

export const TelegramWebhookHandler: IntegrationWebhookHandler<
  TelegramTargetConfig,
  Record<string, never>,
  TelegramConnectionSecrets
> = {
  resolveWebhookRequest(input) {
    const payload = parseTelegramJsonPayload(input.rawBody);
    const providerEventType = resolveTelegramProviderEventType(payload);

    return {
      kind: "event",
      event: resolveTelegramEvent({
        payload,
        providerEventType,
      }),
    };
  },
  resolveConnection(input) {
    return resolvePathRoutedConnection(input.candidates);
  },
  verify(input) {
    const webhookSecret = input.connectionSecrets.webhookSecret;
    if (webhookSecret === undefined || webhookSecret.length === 0) {
      return {
        ok: false,
        code: "invalid-body",
        message: "Telegram webhook secret is missing for this connection.",
      };
    }

    let secretToken: string;
    try {
      secretToken = resolveHeader(input.headers, TelegramSecretTokenHeaderName);
    } catch (error) {
      return {
        ok: false,
        code: "invalid-headers",
        message: error instanceof Error ? error.message : "Telegram headers are invalid.",
      };
    }

    return verifyTelegramWebhookSecret({
      webhookSecret,
      secretToken,
    });
  },
};
