import { createHmac, timingSafeEqual } from "node:crypto";

import type {
  IntegrationConnection,
  IntegrationWebhookEvent,
  IntegrationWebhookHandler,
  IntegrationWebhookResolveConnectionResult,
  IntegrationWebhookVerifyResult,
} from "@mistle/integrations-core";

import type { SlackTargetConfig } from "./target-config-schema.js";
import type { SlackTargetSecrets } from "./target-secret-schema.js";

const SlackSignatureHeaderName = "x-slack-signature";
const SlackTimestampHeaderName = "x-slack-request-timestamp";
const SlackSignatureVersion = "v0";
const SlackTimestampToleranceSeconds = 300;

function parseSlackJsonPayload(input: Uint8Array): Record<string, unknown> {
  const decodedBody = new TextDecoder().decode(input);
  let parsedPayload: unknown;

  try {
    parsedPayload = JSON.parse(decodedBody);
  } catch {
    throw new Error("Slack webhook payload must be valid JSON.");
  }

  if (typeof parsedPayload !== "object" || parsedPayload === null || Array.isArray(parsedPayload)) {
    throw new Error("Slack webhook payload must be a JSON object.");
  }

  return Object.fromEntries(Object.entries(parsedPayload));
}

function resolveSlackRequestType(payload: Record<string, unknown>): string {
  const requestType = payload.type;
  if (typeof requestType !== "string" || requestType.trim().length === 0) {
    throw new Error("Slack webhook payload is missing type.");
  }

  return requestType.trim();
}

function resolveSlackEnvelopeEvent(payload: Record<string, unknown>): Record<string, unknown> {
  const event = payload.event;
  if (typeof event !== "object" || event === null || Array.isArray(event)) {
    throw new Error("Slack Events API payload is missing event.");
  }

  return Object.fromEntries(Object.entries(event));
}

function resolveSlackProviderEventType(payload: Record<string, unknown>): string {
  const event = resolveSlackEnvelopeEvent(payload);
  const providerEventType = event.type;
  if (typeof providerEventType !== "string" || providerEventType.trim().length === 0) {
    throw new Error("Slack event payload is missing event.type.");
  }

  return providerEventType.trim();
}

function resolveSlackNormalizedEventType(providerEventType: string): string {
  if (providerEventType === "message") {
    return "slack:message";
  }

  if (providerEventType === "app_mention") {
    return "slack:app_mention";
  }

  if (providerEventType === "reaction_added") {
    return "slack:reaction_added";
  }

  if (providerEventType === "reaction_removed") {
    return "slack:reaction_removed";
  }

  throw new Error(`Slack event type '${providerEventType}' is not supported.`);
}

function resolveSlackExternalEventId(payload: Record<string, unknown>): string {
  const eventId = payload.event_id;
  if (typeof eventId !== "string" || eventId.trim().length === 0) {
    throw new Error("Slack Events API payload is missing event_id.");
  }

  return eventId.trim();
}

function resolveSlackOccurredAt(payload: Record<string, unknown>): string | undefined {
  const eventTime = payload.event_time;
  if (typeof eventTime !== "number" || !Number.isFinite(eventTime)) {
    return undefined;
  }

  return new Date(eventTime * 1000).toISOString();
}

function resolveSlackSourceOrderKey(payload: Record<string, unknown>): string | undefined {
  const event = resolveSlackEnvelopeEvent(payload);
  const occurredAt = resolveSlackOccurredAt(payload);
  if (occurredAt === undefined) {
    return undefined;
  }

  const eventTimestamp = event.event_ts ?? event.ts;
  if (typeof eventTimestamp !== "string" || eventTimestamp.trim().length === 0) {
    return undefined;
  }

  return `${occurredAt}#${eventTimestamp.trim()}`;
}

function resolvePathRoutedConnection(
  candidates: ReadonlyArray<IntegrationConnection>,
): IntegrationWebhookResolveConnectionResult {
  const candidate = candidates[0];
  if (candidate === undefined) {
    return {
      ok: false,
      code: "connection-not-found",
      message: "No active Slack connection matched the webhook source.",
    };
  }

  if (candidates.length > 1) {
    return {
      ok: false,
      code: "connection-ambiguous",
      message: "Multiple active Slack connections matched the webhook source.",
    };
  }

  return {
    ok: true,
    connectionId: candidate.id,
  };
}

function resolveSlackTimestampHeader(input: Readonly<Record<string, string>>): string {
  const timestamp = input[SlackTimestampHeaderName];
  if (timestamp === undefined || timestamp.trim().length === 0) {
    throw new Error("Slack webhook is missing x-slack-request-timestamp header.");
  }

  return timestamp.trim();
}

function resolveSlackSignatureHeader(input: Readonly<Record<string, string>>): string {
  const signature = input[SlackSignatureHeaderName];
  if (signature === undefined || signature.trim().length === 0) {
    throw new Error("Slack webhook is missing x-slack-signature header.");
  }

  return signature.trim();
}

export function buildSlackWebhookSignature(input: {
  signingSecret: string;
  timestamp: string;
  rawBody: Uint8Array;
}): string {
  const signatureBaseString = `${SlackSignatureVersion}:${input.timestamp}:${new TextDecoder().decode(input.rawBody)}`;
  const signature = createHmac("sha256", input.signingSecret)
    .update(signatureBaseString)
    .digest("hex");
  return `${SlackSignatureVersion}=${signature}`;
}

export function verifySlackWebhookSignature(input: {
  signingSecret: string;
  timestamp: string;
  signature: string;
  rawBody: Uint8Array;
  nowMs?: number;
}): IntegrationWebhookVerifyResult {
  const parsedTimestamp = Number(input.timestamp);
  if (!Number.isInteger(parsedTimestamp)) {
    return {
      ok: false,
      code: "invalid-headers",
      message: "Slack request timestamp header must be an integer Unix timestamp.",
    };
  }

  const nowMs = input.nowMs ?? Date.now();
  const ageSeconds = Math.abs(Math.floor(nowMs / 1000) - parsedTimestamp);
  if (ageSeconds > SlackTimestampToleranceSeconds) {
    return {
      ok: false,
      code: "invalid-signature",
      message: "Slack request timestamp is outside the accepted tolerance window.",
    };
  }

  const [version, providedDigest] = input.signature.split("=", 2);
  if (
    version !== SlackSignatureVersion ||
    providedDigest === undefined ||
    providedDigest.trim().length === 0
  ) {
    return {
      ok: false,
      code: "invalid-signature",
      message: "Slack signature header is malformed.",
    };
  }

  const expectedSignature = buildSlackWebhookSignature({
    signingSecret: input.signingSecret,
    timestamp: input.timestamp,
    rawBody: input.rawBody,
  });

  const expectedBytes = Buffer.from(expectedSignature, "utf8");
  const actualBytes = Buffer.from(input.signature, "utf8");
  if (expectedBytes.length !== actualBytes.length) {
    return {
      ok: false,
      code: "invalid-signature",
      message: "Slack signature did not match.",
    };
  }

  if (!timingSafeEqual(expectedBytes, actualBytes)) {
    return {
      ok: false,
      code: "invalid-signature",
      message: "Slack signature did not match.",
    };
  }

  return { ok: true };
}

export const SlackWebhookHandler: IntegrationWebhookHandler<
  SlackTargetConfig,
  SlackTargetSecrets,
  Record<string, string>
> = {
  resolveWebhookRequest(input) {
    const payload = parseSlackJsonPayload(input.rawBody);
    const requestType = resolveSlackRequestType(payload);

    if (requestType === "url_verification") {
      const challenge = payload.challenge;
      if (typeof challenge !== "string" || challenge.trim().length === 0) {
        throw new Error("Slack URL verification payload is missing challenge.");
      }

      return {
        kind: "response",
        verification: "required",
        event: {
          externalEventId: `url_verification:${challenge.trim()}`,
          providerEventType: "url_verification",
          eventType: "slack:url_verification",
          payload,
        },
        response: {
          status: 200,
          contentType: "text/plain",
          body: challenge.trim(),
        },
      };
    }

    if (requestType !== "event_callback") {
      throw new Error(`Slack request type '${requestType}' is not supported.`);
    }

    const providerEventType = resolveSlackProviderEventType(payload);
    const event: IntegrationWebhookEvent = {
      externalEventId: resolveSlackExternalEventId(payload),
      providerEventType,
      eventType: resolveSlackNormalizedEventType(providerEventType),
      payload,
    };
    const occurredAt = resolveSlackOccurredAt(payload);
    if (occurredAt !== undefined) {
      event.occurredAt = occurredAt;
    }
    const sourceOrderKey = resolveSlackSourceOrderKey(payload);
    if (sourceOrderKey !== undefined) {
      event.sourceOrderKey = sourceOrderKey;
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
    const signingSecret = input.connectionSecrets.signingSecret;
    if (typeof signingSecret !== "string" || signingSecret.length === 0) {
      return {
        ok: false,
        code: "invalid-signature",
        message: "Slack signing secret is missing for the resolved connection.",
      };
    }

    let timestamp: string;
    let signature: string;
    try {
      timestamp = resolveSlackTimestampHeader(input.headers);
      signature = resolveSlackSignatureHeader(input.headers);
    } catch (error) {
      return {
        ok: false,
        code: "invalid-headers",
        message: error instanceof Error ? error.message : "Slack headers are invalid.",
      };
    }

    return verifySlackWebhookSignature({
      signingSecret,
      timestamp,
      signature,
      rawBody: input.rawBody,
    });
  },
};
