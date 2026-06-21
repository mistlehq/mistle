import { createHash, timingSafeEqual } from "node:crypto";

import {
  createIntegrationWebhookSourceOrderKey,
  IntegrationWebhookError,
  type IntegrationConnection,
  type IntegrationWebhookEvent,
  type IntegrationWebhookHandler,
  type IntegrationWebhookResolveConnectionResult,
  type IntegrationWebhookVerifyResult,
  WebhookErrorCodes,
} from "@mistle/integrations-core";
import { z } from "zod";

import { WasenderApiSupportedWebhookEvents } from "./supported-webhook-events.js";
import type { WasenderApiTargetConfig } from "./target-config-schema.js";

const WasenderApiWebhookSignatureHeaderName = "x-webhook-signature";
const WasenderApiWebhookTestEventType = "webhook.test";

const WasenderApiWebhookPayloadSchema = z.record(z.string(), z.unknown());

type WasenderApiConnectionSecrets = {
  webhookSecret?: string;
};

function createInvalidWasenderApiWebhookRequestError(message: string): IntegrationWebhookError {
  return new IntegrationWebhookError(WebhookErrorCodes.WEBHOOK_REQUEST_INVALID, message);
}

function parseWasenderApiJsonPayload(input: Uint8Array): Record<string, unknown> {
  const decodedBody = new TextDecoder().decode(input);
  let parsedPayload: unknown;

  try {
    parsedPayload = JSON.parse(decodedBody);
  } catch {
    throw createInvalidWasenderApiWebhookRequestError(
      "WasenderAPI webhook payload must be valid JSON.",
    );
  }

  const parseResult = WasenderApiWebhookPayloadSchema.safeParse(parsedPayload);
  if (!parseResult.success) {
    throw createInvalidWasenderApiWebhookRequestError(
      "WasenderAPI webhook payload must be a JSON object.",
    );
  }

  return parseResult.data;
}

function resolveStringField(input: Readonly<Record<string, unknown>>, key: string): string {
  const value = input[key];
  if (typeof value !== "string" || value.trim().length === 0) {
    throw createInvalidWasenderApiWebhookRequestError(
      `WasenderAPI webhook payload is missing ${key}.`,
    );
  }

  return value.trim();
}

function resolveOptionalStringField(
  input: Readonly<Record<string, unknown>>,
  key: string,
): string | undefined {
  const value = input[key];
  if (typeof value !== "string") {
    return undefined;
  }

  const trimmedValue = value.trim();
  return trimmedValue.length === 0 ? undefined : trimmedValue;
}

function resolveNestedStringField(input: {
  payload: Readonly<Record<string, unknown>>;
  path: readonly string[];
}): string | undefined {
  const current = resolveNestedField(input);
  if (typeof current !== "string") {
    return undefined;
  }

  const trimmedValue = current.trim();
  return trimmedValue.length === 0 ? undefined : trimmedValue;
}

function resolveNestedNumberField(input: {
  payload: Readonly<Record<string, unknown>>;
  path: readonly string[];
}): number | undefined {
  const current = resolveNestedField(input);
  return typeof current === "number" && Number.isFinite(current) ? current : undefined;
}

function resolveNestedField(input: {
  payload: Readonly<Record<string, unknown>>;
  path: readonly string[];
}): unknown {
  let current: unknown = input.payload;
  for (const segment of input.path) {
    if (typeof current !== "object" || current === null) {
      return undefined;
    }

    if (Array.isArray(current)) {
      const index = Number.parseInt(segment, 10);
      if (!Number.isInteger(index) || index < 0) {
        return undefined;
      }
      current = current[index];
      continue;
    }

    current = Object.entries(current).find(([key]) => key === segment)?.[1];
  }

  return current;
}

function resolveWasenderApiMessageId(
  payload: Readonly<Record<string, unknown>>,
): string | undefined {
  return (
    resolveNestedStringField({ payload, path: ["data", "messages", "key", "id"] }) ??
    resolveNestedStringField({ payload, path: ["data", "messages", "0", "key", "id"] }) ??
    resolveNestedStringField({ payload, path: ["data", "key", "id"] }) ??
    resolveNestedStringField({ payload, path: ["data", "message", "key", "id"] }) ??
    resolveNestedStringField({ payload, path: ["data", "keys", "0", "id"] }) ??
    resolveNestedStringField({ payload, path: ["data", "0", "key", "id"] })
  );
}

function resolveWasenderApiResourceId(
  payload: Readonly<Record<string, unknown>>,
): string | undefined {
  return (
    resolveNestedStringField({ payload, path: ["data", "id"] }) ??
    resolveNestedStringField({ payload, path: ["data", "jid"] }) ??
    resolveNestedStringField({ payload, path: ["data", "0", "id"] }) ??
    resolveNestedStringField({ payload, path: ["data", "0", "jid"] }) ??
    resolveNestedStringField({ payload, path: ["data", "0"] })
  );
}

function resolveWasenderApiDeliveryId(input: {
  eventType: string;
  payload: Readonly<Record<string, unknown>>;
  rawBody: Uint8Array;
}): string {
  return (
    resolveOptionalStringField(input.payload, "id") ??
    resolveOptionalStringField(input.payload, "messageId") ??
    resolveWasenderApiMessageId(input.payload) ??
    resolveWasenderApiResourceId(input.payload) ??
    resolveOptionalStringField(input.payload, "sessionId") ??
    `${input.eventType}:${createHash("sha256").update(input.rawBody).digest("hex")}`
  );
}

function resolveWasenderApiWebhookTestDeliveryId(input: {
  payload: Readonly<Record<string, unknown>>;
  rawBody: Uint8Array;
}): string {
  return (
    resolveOptionalStringField(input.payload, "id") ??
    resolveOptionalStringField(input.payload, "testId") ??
    `${WasenderApiWebhookTestEventType}:${createHash("sha256").update(input.rawBody).digest("hex")}`
  );
}

function normalizeWasenderApiTimestamp(input: string | number | undefined): string | undefined {
  if (input === undefined) {
    return undefined;
  }

  if (typeof input === "number") {
    const timestampMs = input < 10_000_000_000 ? input * 1000 : input;
    return new Date(timestampMs).toISOString();
  }

  const timestampMs = Date.parse(input);
  if (!Number.isFinite(timestampMs)) {
    return undefined;
  }

  return new Date(timestampMs).toISOString();
}

function resolveWasenderApiOccurredAt(
  payload: Readonly<Record<string, unknown>>,
): string | undefined {
  const stringCandidate =
    resolveOptionalStringField(payload, "timestamp") ??
    resolveOptionalStringField(payload, "createdAt") ??
    resolveNestedStringField({ payload, path: ["data", "timestamp"] }) ??
    resolveNestedStringField({ payload, path: ["data", "createdAt"] }) ??
    resolveNestedStringField({ payload, path: ["data", "messages", "messageTimestamp"] }) ??
    resolveNestedStringField({ payload, path: ["data", "messages", "0", "messageTimestamp"] });
  const numberCandidate =
    resolveNestedNumberField({ payload, path: ["timestamp"] }) ??
    resolveNestedNumberField({ payload, path: ["data", "timestamp"] }) ??
    resolveNestedNumberField({ payload, path: ["data", "messages", "messageTimestamp"] }) ??
    resolveNestedNumberField({ payload, path: ["data", "messages", "0", "messageTimestamp"] });

  return normalizeWasenderApiTimestamp(stringCandidate ?? numberCandidate);
}

function resolveHeader(input: Readonly<Record<string, string>>, headerName: string): string {
  const value = input[headerName];
  if (value === undefined || value.trim().length === 0) {
    throw new Error(`WasenderAPI webhook is missing ${headerName} header.`);
  }

  return value.trim();
}

function resolvePathRoutedConnection(
  candidates: ReadonlyArray<IntegrationConnection>,
): IntegrationWebhookResolveConnectionResult {
  const candidate = candidates[0];
  if (candidate === undefined) {
    return {
      ok: false,
      code: "connection-not-found",
      message: "No active WasenderAPI connection matched the webhook source.",
    };
  }

  if (candidates.length > 1) {
    return {
      ok: false,
      code: "connection-ambiguous",
      message: "Multiple active WasenderAPI connections matched the webhook source.",
    };
  }

  return {
    ok: true,
    connectionId: candidate.id,
  };
}

export function verifyWasenderApiWebhookSignature(input: {
  webhookSecret: string;
  signature: string;
}): IntegrationWebhookVerifyResult {
  const expectedBytes = Buffer.from(input.webhookSecret);
  const actualBytes = Buffer.from(input.signature);
  if (expectedBytes.length !== actualBytes.length || !timingSafeEqual(expectedBytes, actualBytes)) {
    return {
      ok: false,
      code: "invalid-signature",
      message: "WasenderAPI webhook signature verification failed.",
    };
  }

  return { ok: true };
}

export const WasenderApiWebhookHandler: IntegrationWebhookHandler<
  WasenderApiTargetConfig,
  Record<string, never>,
  WasenderApiConnectionSecrets
> = {
  resolveWebhookRequest(input) {
    const payload = parseWasenderApiJsonPayload(input.rawBody);
    const providerEventType = resolveStringField(payload, "event");
    if (providerEventType === WasenderApiWebhookTestEventType) {
      const deliveryId = resolveWasenderApiWebhookTestDeliveryId({
        payload,
        rawBody: input.rawBody,
      });

      return {
        kind: "response",
        verification: "required",
        event: {
          externalEventId: deliveryId,
          externalDeliveryId: deliveryId,
          providerEventType,
          eventType: "wasenderapi.webhook.test",
          payload,
          sourceOrderKey: deliveryId,
        },
        response: {
          status: 200,
          body: {
            received: true,
          },
        },
      };
    }

    const supportedEventDefinition = WasenderApiSupportedWebhookEvents.find(
      (eventDefinition) => eventDefinition.providerEventType === providerEventType,
    );
    if (supportedEventDefinition === undefined) {
      throw createInvalidWasenderApiWebhookRequestError(
        `WasenderAPI webhook event '${providerEventType}' is not supported.`,
      );
    }

    const deliveryId = resolveWasenderApiDeliveryId({
      eventType: providerEventType,
      payload,
      rawBody: input.rawBody,
    });
    const event: IntegrationWebhookEvent = {
      externalEventId: deliveryId,
      externalDeliveryId: deliveryId,
      providerEventType,
      eventType: supportedEventDefinition.eventType,
      payload,
    };
    const occurredAt = resolveWasenderApiOccurredAt(payload);
    if (occurredAt !== undefined) {
      event.occurredAt = occurredAt;
      event.sourceOrderKey = createIntegrationWebhookSourceOrderKey({
        occurredAt,
        orderingIdentifier: deliveryId,
      });
    } else {
      event.sourceOrderKey = deliveryId;
    }

    return {
      kind: "event",
      event,
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
        message: "WasenderAPI webhook secret is missing for this connection.",
      };
    }

    let signature: string;
    try {
      signature = resolveHeader(input.headers, WasenderApiWebhookSignatureHeaderName);
    } catch (error) {
      return {
        ok: false,
        code: "invalid-headers",
        message: error instanceof Error ? error.message : "WasenderAPI headers are invalid.",
      };
    }

    return verifyWasenderApiWebhookSignature({
      webhookSecret,
      signature,
    });
  },
};
