import { createHmac, timingSafeEqual } from "node:crypto";

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

import { SentrySupportedWebhookEvents } from "./supported-webhook-events.js";

const SentryHookResourceHeaderName = "sentry-hook-resource";
const SentryHookSignatureHeaderName = "sentry-hook-signature";
const SentryRequestIdHeaderName = "request-id";
const SentryIssueResource = "issue";

const SentryWebhookPayloadSchema = z.record(z.string(), z.unknown());

type SentryConnectionSecrets = {
  clientSecret?: string;
};

function createInvalidSentryWebhookRequestError(message: string): IntegrationWebhookError {
  return new IntegrationWebhookError(WebhookErrorCodes.WEBHOOK_REQUEST_INVALID, message);
}

function parseSentryJsonPayload(input: Uint8Array): Record<string, unknown> {
  const decodedBody = new TextDecoder().decode(input);
  let parsedPayload: unknown;

  try {
    parsedPayload = JSON.parse(decodedBody);
  } catch {
    throw createInvalidSentryWebhookRequestError("Sentry webhook payload must be valid JSON.");
  }

  const parseResult = SentryWebhookPayloadSchema.safeParse(parsedPayload);
  if (!parseResult.success) {
    throw createInvalidSentryWebhookRequestError("Sentry webhook payload must be a JSON object.");
  }

  return parseResult.data;
}

function resolveStringField(input: Readonly<Record<string, unknown>>, key: string): string {
  const value = input[key];
  if (typeof value !== "string" || value.trim().length === 0) {
    throw createInvalidSentryWebhookRequestError(`Sentry webhook payload is missing ${key}.`);
  }

  return value.trim();
}

function resolveNestedField(input: {
  payload: Readonly<Record<string, unknown>>;
  path: readonly string[];
}): unknown {
  let current: unknown = input.payload;
  for (const segment of input.path) {
    if (typeof current !== "object" || current === null || Array.isArray(current)) {
      return undefined;
    }

    current = Object.entries(current).find(([key]) => key === segment)?.[1];
  }

  return current;
}

function resolveNestedStringField(input: {
  payload: Readonly<Record<string, unknown>>;
  path: readonly string[];
}): string | undefined {
  const value = resolveNestedField(input);
  if (typeof value !== "string") {
    return undefined;
  }

  const trimmedValue = value.trim();
  return trimmedValue.length === 0 ? undefined : trimmedValue;
}

function resolveHeader(
  headers: Readonly<Record<string, string>>,
  headerName: string,
): string | undefined {
  const value = headers[headerName];
  if (value === undefined || value.trim().length === 0) {
    return undefined;
  }

  return value.trim();
}

function resolveRequiredHeader(
  headers: Readonly<Record<string, string>>,
  headerName: string,
): string {
  const value = resolveHeader(headers, headerName);
  if (value === undefined) {
    throw createInvalidSentryWebhookRequestError(`Sentry webhook is missing ${headerName} header.`);
  }

  return value;
}

function resolveSentryIssueEventDefinition(action: string) {
  const providerEventType = `${SentryIssueResource}.${action}`;
  const eventDefinition = SentrySupportedWebhookEvents.find(
    (definition) => definition.providerEventType === providerEventType,
  );
  if (eventDefinition === undefined) {
    throw createInvalidSentryWebhookRequestError(
      `Sentry issue webhook action '${action}' is not supported.`,
    );
  }

  return eventDefinition;
}

function resolveSentryIssueIdentifier(payload: Readonly<Record<string, unknown>>): string {
  const issueId = resolveNestedStringField({ payload, path: ["data", "issue", "id"] });
  if (issueId === undefined) {
    throw createInvalidSentryWebhookRequestError(
      "Sentry issue webhook payload is missing data.issue.id.",
    );
  }

  return issueId;
}

function resolveSentryOccurredAt(payload: Readonly<Record<string, unknown>>): string | undefined {
  const timestamp = resolveNestedStringField({
    payload,
    path: ["data", "issue", "lastSeen"],
  });
  if (timestamp === undefined) {
    return undefined;
  }

  const timestampMs = Date.parse(timestamp);
  if (!Number.isFinite(timestampMs)) {
    return undefined;
  }

  return new Date(timestampMs).toISOString();
}

function resolvePathRoutedConnection(
  candidates: ReadonlyArray<IntegrationConnection>,
): IntegrationWebhookResolveConnectionResult {
  const candidate = candidates[0];
  if (candidate === undefined) {
    return {
      ok: false,
      code: "connection-not-found",
      message: "No active Sentry connection matched the webhook source.",
    };
  }

  if (candidates.length > 1) {
    return {
      ok: false,
      code: "connection-ambiguous",
      message: "Multiple active Sentry connections matched the webhook source.",
    };
  }

  return {
    ok: true,
    connectionId: candidate.id,
  };
}

export function buildSentryWebhookSignature(input: {
  clientSecret: string;
  rawBody: Uint8Array;
}): string {
  // Source: https://docs.sentry.io/integrations/integration-platform/webhooks/
  return createHmac("sha256", input.clientSecret).update(input.rawBody).digest("hex");
}

export function verifySentryWebhookSignature(input: {
  clientSecret: string;
  signature: string;
  rawBody: Uint8Array;
}): IntegrationWebhookVerifyResult {
  if (!/^[0-9a-f]+$/i.test(input.signature) || input.signature.length % 2 !== 0) {
    return {
      ok: false,
      code: "invalid-signature",
      message: "Sentry signature header must be hex-encoded.",
    };
  }

  const expectedSignature = buildSentryWebhookSignature({
    clientSecret: input.clientSecret,
    rawBody: input.rawBody,
  });
  const expectedBytes = Buffer.from(expectedSignature, "hex");
  const actualBytes = Buffer.from(input.signature, "hex");
  if (expectedBytes.length !== actualBytes.length || !timingSafeEqual(expectedBytes, actualBytes)) {
    return {
      ok: false,
      code: "invalid-signature",
      message: "Sentry webhook signature verification failed.",
    };
  }

  return { ok: true };
}

export const SentryWebhookHandler: IntegrationWebhookHandler<
  Record<string, never>,
  Record<string, never>,
  SentryConnectionSecrets
> = {
  resolveWebhookRequest(input) {
    const payload = parseSentryJsonPayload(input.rawBody);
    const resource = resolveRequiredHeader(input.headers, SentryHookResourceHeaderName);
    if (resource !== SentryIssueResource) {
      throw createInvalidSentryWebhookRequestError(
        `Sentry webhook resource '${resource}' is not supported.`,
      );
    }

    const action = resolveStringField(payload, "action");
    const eventDefinition = resolveSentryIssueEventDefinition(action);
    const requestId = resolveRequiredHeader(input.headers, SentryRequestIdHeaderName);
    const issueIdentifier = resolveSentryIssueIdentifier(payload);
    const event: IntegrationWebhookEvent = {
      externalEventId: `${eventDefinition.providerEventType}:${issueIdentifier}:${requestId}`,
      externalDeliveryId: requestId,
      providerEventType: eventDefinition.providerEventType,
      eventType: eventDefinition.eventType,
      payload,
    };
    const occurredAt = resolveSentryOccurredAt(payload);
    if (occurredAt !== undefined) {
      event.occurredAt = occurredAt;
      event.sourceOrderKey = createIntegrationWebhookSourceOrderKey({
        occurredAt,
        orderingIdentifier: requestId,
      });
    } else {
      event.sourceOrderKey = requestId;
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
    const clientSecret = input.connectionSecrets.clientSecret;
    if (clientSecret === undefined || clientSecret.length === 0) {
      return {
        ok: false,
        code: "invalid-body",
        message: "Sentry webhook client secret is missing for this connection.",
      };
    }

    let signature: string;
    try {
      signature = resolveRequiredHeader(input.headers, SentryHookSignatureHeaderName);
    } catch (error) {
      return {
        ok: false,
        code: "invalid-headers",
        message: error instanceof Error ? error.message : "Sentry headers are invalid.",
      };
    }

    return verifySentryWebhookSignature({
      clientSecret,
      signature,
      rawBody: input.rawBody,
    });
  },
};
