import { createHash, timingSafeEqual } from "node:crypto";

import {
  createIntegrationWebhookSourceOrderKey,
  type IntegrationConnection,
  type IntegrationWebhookEvent,
  type IntegrationWebhookHandler,
  type IntegrationWebhookResolveConnectionResult,
  type IntegrationWebhookVerifyResult,
} from "@mistle/integrations-core";
import { z } from "zod";

import { WhapiWebhookSecretHeaderName } from "./auth.js";
import { WhapiSupportedWebhookEvents } from "./supported-webhook-events.js";
import type { WhapiTargetConfig } from "./target-config-schema.js";

const WhapiWebhookPayloadSchema = z.record(z.string(), z.unknown());

type WhapiConnectionSecrets = {
  webhookSecret?: string;
};

function parseWhapiJsonPayload(input: Uint8Array): Record<string, unknown> {
  const decodedBody = new TextDecoder().decode(input);
  let parsedPayload: unknown;

  try {
    parsedPayload = JSON.parse(decodedBody);
  } catch {
    throw new Error("Whapi webhook payload must be valid JSON.");
  }

  return WhapiWebhookPayloadSchema.parse(parsedPayload);
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

function resolveWhapiProviderEventType(payload: Readonly<Record<string, unknown>>): string {
  const eventType = resolveNestedStringField({ payload, path: ["event", "type"] });
  const updateType = resolveNestedStringField({ payload, path: ["event", "event"] });
  if (eventType === undefined || updateType === undefined) {
    throw new Error("Whapi webhook payload is missing event.type or event.event.");
  }

  return `${eventType}.${updateType}`;
}

function resolveWhapiDeliveryId(input: {
  providerEventType: string;
  payload: Readonly<Record<string, unknown>>;
  rawBody: Uint8Array;
}): string {
  const bodyHash = createHash("sha256").update(input.rawBody).digest("hex");
  const objectId =
    resolveNestedStringField({ payload: input.payload, path: ["messages", "0", "id"] }) ??
    resolveNestedStringField({ payload: input.payload, path: ["statuses", "0", "id"] });
  if (objectId !== undefined) {
    return `${input.providerEventType}:${objectId}:${bodyHash}`;
  }

  return `${input.providerEventType}:${bodyHash}`;
}

function normalizeWhapiTimestamp(input: string | number | undefined): string | undefined {
  if (input === undefined) {
    return undefined;
  }

  if (typeof input === "number") {
    const timestampMs = input < 10_000_000_000 ? input * 1000 : input;
    return new Date(timestampMs).toISOString();
  }

  const numericTimestamp = Number(input);
  if (Number.isFinite(numericTimestamp)) {
    return normalizeWhapiTimestamp(numericTimestamp);
  }

  const timestampMs = Date.parse(input);
  if (!Number.isFinite(timestampMs)) {
    return undefined;
  }

  return new Date(timestampMs).toISOString();
}

function resolveWhapiOccurredAt(payload: Readonly<Record<string, unknown>>): string | undefined {
  const stringCandidate =
    resolveNestedStringField({ payload, path: ["messages", "0", "timestamp"] }) ??
    resolveNestedStringField({ payload, path: ["statuses", "0", "timestamp"] }) ??
    resolveNestedStringField({ payload, path: ["timestamp"] });
  const numberCandidate =
    resolveNestedNumberField({ payload, path: ["messages", "0", "timestamp"] }) ??
    resolveNestedNumberField({ payload, path: ["statuses", "0", "timestamp"] }) ??
    resolveNestedNumberField({ payload, path: ["health", "start_at"] }) ??
    resolveNestedNumberField({ payload, path: ["timestamp"] });

  return normalizeWhapiTimestamp(stringCandidate ?? numberCandidate);
}

function resolveHeader(input: Readonly<Record<string, string>>, headerName: string): string {
  const value = input[headerName];
  if (value === undefined || value.trim().length === 0) {
    throw new Error(`Whapi webhook is missing ${headerName} header.`);
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
      message: "No active Whapi connection matched the webhook source.",
    };
  }

  if (candidates.length > 1) {
    return {
      ok: false,
      code: "connection-ambiguous",
      message: "Multiple active Whapi connections matched the webhook source.",
    };
  }

  return {
    ok: true,
    connectionId: candidate.id,
  };
}

export function verifyWhapiWebhookSecret(input: {
  webhookSecret: string;
  headerValue: string;
}): IntegrationWebhookVerifyResult {
  const expectedBytes = Buffer.from(input.webhookSecret);
  const actualBytes = Buffer.from(input.headerValue);
  if (expectedBytes.length !== actualBytes.length || !timingSafeEqual(expectedBytes, actualBytes)) {
    return {
      ok: false,
      code: "invalid-signature",
      message: "Whapi webhook secret verification failed.",
    };
  }

  return { ok: true };
}

export const WhapiWebhookHandler: IntegrationWebhookHandler<
  WhapiTargetConfig,
  Record<string, never>,
  WhapiConnectionSecrets
> = {
  resolveWebhookRequest(input) {
    const payload = parseWhapiJsonPayload(input.rawBody);
    const providerEventType = resolveWhapiProviderEventType(payload);
    const supportedEventDefinition = WhapiSupportedWebhookEvents.find(
      (eventDefinition) => eventDefinition.providerEventType === providerEventType,
    );
    if (supportedEventDefinition === undefined) {
      throw new Error(`Whapi webhook event '${providerEventType}' is not supported.`);
    }

    const deliveryId = resolveWhapiDeliveryId({
      providerEventType,
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
    const occurredAt = resolveWhapiOccurredAt(payload);
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
        message: "Whapi webhook secret is missing for this connection.",
      };
    }

    let headerValue: string;
    try {
      headerValue = resolveHeader(input.headers, WhapiWebhookSecretHeaderName);
    } catch (error) {
      return {
        ok: false,
        code: "invalid-headers",
        message: error instanceof Error ? error.message : "Whapi headers are invalid.",
      };
    }

    return verifyWhapiWebhookSecret({
      webhookSecret,
      headerValue,
    });
  },
};
