import { createHash, createHmac, createPublicKey, timingSafeEqual, verify } from "node:crypto";

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

import { DiscordSupportedWebhookEvents } from "./supported-webhook-events.js";
import type { DiscordTargetConfig } from "./target-config-schema.js";

const DiscordSignatureHeaderName = "x-signature-ed25519";
const DiscordTimestampHeaderName = "x-signature-timestamp";
const DiscordGatewayRelaySignatureHeaderName = "x-mistle-discord-gateway-signature";
const DiscordGatewayRelayTimestampHeaderName = "x-mistle-discord-gateway-timestamp";
const DiscordInteractionPingType = 1;
const DiscordInteractionPongResponseType = 1;
const DiscordInteractionDeferredChannelMessageResponseType = 5;
const DiscordWebhookEventPingType = 0;
const DiscordGatewayDispatchOpcode = 0;
const DiscordGatewayRelayProviderEventTypes = new Set([
  "MESSAGE_CREATE",
  "MESSAGE_UPDATE",
  "MESSAGE_DELETE",
  "MESSAGE_REACTION_ADD",
  "MESSAGE_REACTION_REMOVE",
]);
const DiscordWebhookPayloadSchema = z.record(z.string(), z.unknown());
const Ed25519SpkiPrefix = Buffer.from("302a300506032b6570032100", "hex");

type DiscordConnectionSecrets = {
  botToken?: string;
  publicKey?: string;
};

function createInvalidDiscordWebhookRequestError(message: string): IntegrationWebhookError {
  return new IntegrationWebhookError(WebhookErrorCodes.WEBHOOK_REQUEST_INVALID, message);
}

function parseDiscordJsonPayload(input: Uint8Array): Record<string, unknown> {
  const decodedBody = new TextDecoder().decode(input);
  let parsedPayload: unknown;

  try {
    parsedPayload = JSON.parse(decodedBody);
  } catch {
    throw createInvalidDiscordWebhookRequestError("Discord webhook payload must be valid JSON.");
  }

  const parseResult = DiscordWebhookPayloadSchema.safeParse(parsedPayload);
  if (!parseResult.success) {
    throw createInvalidDiscordWebhookRequestError("Discord webhook payload must be a JSON object.");
  }

  return parseResult.data;
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

function resolveOptionalNumberField(
  input: Readonly<Record<string, unknown>>,
  key: string,
): number | undefined {
  const value = input[key];
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function resolveHeader(input: Readonly<Record<string, string>>, headerName: string): string {
  const value = input[headerName];
  if (value === undefined || value.trim().length === 0) {
    throw new Error(`Discord webhook is missing ${headerName} header.`);
  }

  return value.trim();
}

function isRecordObject(input: unknown): input is Readonly<Record<string, unknown>> {
  return typeof input === "object" && input !== null && !Array.isArray(input);
}

function resolvePathRoutedConnection(
  candidates: ReadonlyArray<IntegrationConnection>,
): IntegrationWebhookResolveConnectionResult {
  const candidate = candidates[0];
  if (candidate === undefined) {
    return {
      ok: false,
      code: "connection-not-found",
      message: "No active Discord connection matched the webhook source.",
    };
  }

  if (candidates.length > 1) {
    return {
      ok: false,
      code: "connection-ambiguous",
      message: "Multiple active Discord connections matched the webhook source.",
    };
  }

  return {
    ok: true,
    connectionId: candidate.id,
  };
}

function resolveDiscordProviderEventType(payload: Readonly<Record<string, unknown>>): string {
  if (resolveOptionalNumberField(payload, "op") === DiscordGatewayDispatchOpcode) {
    const gatewayEventType = resolveOptionalStringField(payload, "t");
    if (gatewayEventType !== undefined) {
      return gatewayEventType.toUpperCase();
    }
  }

  const stringType = resolveOptionalStringField(payload, "type");
  if (stringType !== undefined) {
    return stringType.toLowerCase();
  }

  if (isRecordObject(payload.event)) {
    const eventType = resolveOptionalStringField(payload.event, "type");
    if (eventType !== undefined) {
      return eventType.toLowerCase();
    }
  }

  const interactionType = resolveOptionalNumberField(payload, "type");
  if (interactionType !== undefined) {
    return "interaction";
  }

  throw createInvalidDiscordWebhookRequestError("Discord webhook payload is missing type.");
}

function resolveDiscordDeliveryId(input: {
  providerEventType: string;
  payload: Readonly<Record<string, unknown>>;
  rawBody: Uint8Array;
}): string {
  const data = input.payload["d"];
  if (isRecordObject(data)) {
    const dataRecord = data;
    const dataId = resolveOptionalStringField(dataRecord, "id");
    if (dataId !== undefined) {
      const gatewaySequence = resolveOptionalNumberField(input.payload, "s");
      if (gatewaySequence !== undefined) {
        return `${input.providerEventType}:${gatewaySequence}:${dataId}`;
      }

      return `${input.providerEventType}:${dataId}`;
    }
  }

  return (
    resolveOptionalStringField(input.payload, "id") ??
    resolveOptionalStringField(input.payload, "event_id") ??
    `${input.providerEventType}:${createHash("sha256").update(input.rawBody).digest("hex")}`
  );
}

function resolveDiscordOccurredAt(payload: Readonly<Record<string, unknown>>): string | undefined {
  const data = payload["d"];
  if (isRecordObject(data)) {
    const dataRecord = data;
    const dataTimestamp =
      resolveOptionalStringField(dataRecord, "timestamp") ??
      resolveOptionalStringField(dataRecord, "created_at");
    if (dataTimestamp !== undefined) {
      const timestampMs = Date.parse(dataTimestamp);
      return Number.isFinite(timestampMs) ? new Date(timestampMs).toISOString() : undefined;
    }
  }

  if (isRecordObject(payload.event)) {
    const eventTimestamp =
      resolveOptionalStringField(payload.event, "timestamp") ??
      resolveOptionalStringField(payload.event, "created_at");
    if (eventTimestamp !== undefined) {
      const timestampMs = Date.parse(eventTimestamp);
      return Number.isFinite(timestampMs) ? new Date(timestampMs).toISOString() : undefined;
    }
  }

  const timestamp =
    resolveOptionalStringField(payload, "timestamp") ??
    resolveOptionalStringField(payload, "created_at");
  if (timestamp === undefined) {
    return undefined;
  }

  const timestampMs = Date.parse(timestamp);
  if (!Number.isFinite(timestampMs)) {
    return undefined;
  }

  return new Date(timestampMs).toISOString();
}

function isDiscordInteractionPing(payload: Readonly<Record<string, unknown>>): boolean {
  return (
    resolveOptionalNumberField(payload, "type") === DiscordInteractionPingType &&
    !isRecordObject(payload.event)
  );
}

function isDiscordWebhookEventPing(payload: Readonly<Record<string, unknown>>): boolean {
  return resolveOptionalNumberField(payload, "type") === DiscordWebhookEventPingType;
}

export function verifyDiscordWebhookSignature(input: {
  publicKey: string;
  signature: string;
  timestamp: string;
  rawBody: Uint8Array;
}): IntegrationWebhookVerifyResult {
  const publicKeyHex = input.publicKey.trim();
  if (!/^[0-9a-f]{64}$/iu.test(publicKeyHex)) {
    return {
      ok: false,
      code: "invalid-body",
      message: "Discord public key must be a 32-byte hex string.",
    };
  }

  const signatureHex = input.signature.trim();
  if (!/^[0-9a-f]{128}$/iu.test(signatureHex)) {
    return {
      ok: false,
      code: "invalid-headers",
      message: "Discord webhook signature must be a 64-byte hex string.",
    };
  }

  const key = createPublicKey({
    key: Buffer.concat([Ed25519SpkiPrefix, Buffer.from(publicKeyHex, "hex")]),
    format: "der",
    type: "spki",
  });
  const signedPayload = Buffer.concat([Buffer.from(input.timestamp), Buffer.from(input.rawBody)]);
  const verified = verify(null, signedPayload, key, Buffer.from(signatureHex, "hex"));

  if (!verified) {
    return {
      ok: false,
      code: "invalid-signature",
      message: "Discord webhook signature verification failed.",
    };
  }

  return { ok: true };
}

function hasDiscordGatewayRelaySignature(headers: Readonly<Record<string, string>>): boolean {
  return (
    headers[DiscordGatewayRelaySignatureHeaderName] !== undefined ||
    headers[DiscordGatewayRelayTimestampHeaderName] !== undefined
  );
}

function isDiscordGatewayRelayProviderEventType(providerEventType: string): boolean {
  return DiscordGatewayRelayProviderEventTypes.has(providerEventType);
}

export function verifyDiscordGatewayRelaySignature(input: {
  botToken: string;
  signature: string;
  timestamp: string;
  rawBody: Uint8Array;
}): IntegrationWebhookVerifyResult {
  const botToken = input.botToken.trim();
  if (botToken.length === 0) {
    return {
      ok: false,
      code: "invalid-body",
      message: "Discord bot token is missing for Gateway relay verification.",
    };
  }

  const signatureHex = input.signature.trim();
  if (!/^[0-9a-f]{64}$/iu.test(signatureHex)) {
    return {
      ok: false,
      code: "invalid-headers",
      message: "Discord Gateway relay signature must be a 32-byte hex string.",
    };
  }

  const signedPayload = Buffer.concat([Buffer.from(input.timestamp), Buffer.from(input.rawBody)]);
  const expectedSignature = createHmac("sha256", botToken).update(signedPayload).digest();
  const actualSignature = Buffer.from(signatureHex, "hex");
  const verified =
    actualSignature.length === expectedSignature.length &&
    timingSafeEqual(actualSignature, expectedSignature);

  if (!verified) {
    return {
      ok: false,
      code: "invalid-signature",
      message: "Discord Gateway relay signature verification failed.",
    };
  }

  return { ok: true };
}

export const DiscordWebhookHandler: IntegrationWebhookHandler<
  DiscordTargetConfig,
  Record<string, never>,
  DiscordConnectionSecrets
> = {
  resolveWebhookRequest(input) {
    const payload = parseDiscordJsonPayload(input.rawBody);
    if (isDiscordInteractionPing(payload)) {
      const deliveryId = resolveDiscordDeliveryId({
        providerEventType: "interaction_ping",
        payload,
        rawBody: input.rawBody,
      });

      return {
        kind: "response",
        verification: "required",
        event: {
          externalEventId: deliveryId,
          externalDeliveryId: deliveryId,
          providerEventType: "interaction_ping",
          eventType: "discord:interaction_ping",
          payload,
          sourceOrderKey: deliveryId,
        },
        response: {
          status: 200,
          body: {
            type: DiscordInteractionPongResponseType,
          },
        },
      };
    }

    if (isDiscordWebhookEventPing(payload)) {
      const deliveryId = resolveDiscordDeliveryId({
        providerEventType: "webhook_ping",
        payload,
        rawBody: input.rawBody,
      });

      return {
        kind: "response",
        verification: "required",
        event: {
          externalEventId: deliveryId,
          externalDeliveryId: deliveryId,
          providerEventType: "webhook_ping",
          eventType: "discord:webhook_ping",
          payload,
          sourceOrderKey: deliveryId,
        },
        response: {
          status: 204,
        },
      };
    }

    const providerEventType = resolveDiscordProviderEventType(payload);
    if (providerEventType === "interaction") {
      const deliveryId = resolveDiscordDeliveryId({
        providerEventType,
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
          eventType: "discord:interaction",
          payload,
          sourceOrderKey: deliveryId,
        },
        response: {
          status: 200,
          body: {
            type: DiscordInteractionDeferredChannelMessageResponseType,
          },
        },
      };
    }

    const supportedEventDefinition = DiscordSupportedWebhookEvents.find(
      (eventDefinition) => eventDefinition.providerEventType === providerEventType,
    );
    if (supportedEventDefinition === undefined) {
      throw createInvalidDiscordWebhookRequestError(
        `Discord webhook event '${providerEventType}' is not supported.`,
      );
    }

    const deliveryId = resolveDiscordDeliveryId({
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
    const occurredAt = resolveDiscordOccurredAt(payload);
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
    if (hasDiscordGatewayRelaySignature(input.headers)) {
      if (!isDiscordGatewayRelayProviderEventType(input.event.providerEventType)) {
        return {
          ok: false,
          code: "invalid-headers",
          message: "Discord Gateway relay signatures can only verify Gateway dispatch events.",
        };
      }

      const botToken = input.connectionSecrets.botToken;
      if (botToken === undefined || botToken.length === 0) {
        return {
          ok: false,
          code: "invalid-body",
          message: "Discord bot token is missing for Gateway relay verification.",
        };
      }

      let signature: string;
      let timestamp: string;
      try {
        signature = resolveHeader(input.headers, DiscordGatewayRelaySignatureHeaderName);
        timestamp = resolveHeader(input.headers, DiscordGatewayRelayTimestampHeaderName);
      } catch (error) {
        return {
          ok: false,
          code: "invalid-headers",
          message:
            error instanceof Error ? error.message : "Discord Gateway relay headers are invalid.",
        };
      }

      return verifyDiscordGatewayRelaySignature({
        botToken,
        signature,
        timestamp,
        rawBody: input.rawBody,
      });
    }

    const publicKey = input.connectionSecrets.publicKey;
    if (publicKey === undefined || publicKey.length === 0) {
      return {
        ok: false,
        code: "invalid-body",
        message: "Discord public key is missing for this connection.",
      };
    }

    let signature: string;
    let timestamp: string;
    try {
      signature = resolveHeader(input.headers, DiscordSignatureHeaderName);
      timestamp = resolveHeader(input.headers, DiscordTimestampHeaderName);
    } catch (error) {
      return {
        ok: false,
        code: "invalid-headers",
        message: error instanceof Error ? error.message : "Discord headers are invalid.",
      };
    }

    return verifyDiscordWebhookSignature({
      publicKey,
      signature,
      timestamp,
      rawBody: input.rawBody,
    });
  },
};
