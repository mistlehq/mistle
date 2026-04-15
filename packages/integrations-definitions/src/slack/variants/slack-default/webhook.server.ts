import { createHmac, timingSafeEqual } from "node:crypto";

import type {
  IntegrationConnection,
  IntegrationWebhookEvent,
  IntegrationWebhookHandler,
  IntegrationWebhookResolveConnectionResult,
  IntegrationWebhookVerifyResult,
} from "@mistle/integrations-core";

import { SlackThreadRootTimestampField } from "./normalized-event-fields.js";
import type { SlackTargetConfig } from "./target-config-schema.js";
import type { SlackTargetSecrets } from "./target-secret-schema.js";

const SlackSignatureHeaderName = "x-slack-signature";
const SlackTimestampHeaderName = "x-slack-request-timestamp";
const SlackSignatureVersion = "v0";
const SlackTimestampToleranceSeconds = 300;
const SlackConversationsRepliesPath = "conversations.replies";

type SlackWebhookConnectionSecrets = {
  botToken?: string;
  signingSecret?: string;
};

function cloneSlackRecord(input: object): Record<string, unknown> {
  return Object.fromEntries(Object.entries(input));
}

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

function resolveSlackProviderEventTypeFromEvent(event: Record<string, unknown>): string {
  const providerEventType = event.type;
  if (typeof providerEventType !== "string" || providerEventType.trim().length === 0) {
    throw new Error("Slack event payload is missing event.type.");
  }

  return providerEventType.trim();
}

function resolveOptionalSlackStringField(
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

function resolveSlackMessageSubtype(event: Record<string, unknown>): string | undefined {
  return resolveOptionalSlackStringField(event, "subtype");
}

function resolveSlackEventClassification(input: {
  rawProviderEventType: string;
  event: Record<string, unknown>;
}): {
  providerEventType: string;
  eventType: string;
} {
  const providerEventType = input.rawProviderEventType;
  if (providerEventType === "message") {
    const messageSubtype = resolveSlackMessageSubtype(input.event);
    if (messageSubtype !== undefined) {
      return {
        providerEventType: messageSubtype,
        eventType: `slack:${messageSubtype}`,
      };
    }

    return {
      providerEventType: "message",
      eventType: "slack:message",
    };
  }

  if (providerEventType === "app_mention") {
    return {
      providerEventType,
      eventType: "slack:app_mention",
    };
  }

  if (providerEventType === "reaction_added") {
    return {
      providerEventType,
      eventType: "slack:reaction_added",
    };
  }

  if (providerEventType === "reaction_removed") {
    return {
      providerEventType,
      eventType: "slack:reaction_removed",
    };
  }

  if (
    providerEventType === "channel_created" ||
    providerEventType === "channel_archive" ||
    providerEventType === "channel_unarchive" ||
    providerEventType === "channel_rename" ||
    providerEventType === "group_archive" ||
    providerEventType === "group_unarchive" ||
    providerEventType === "group_rename"
  ) {
    return {
      providerEventType,
      eventType: `slack:${providerEventType}`,
    };
  }

  throw new Error(`Slack event type '${providerEventType}' is not supported.`);
}

function enrichSlackEventForAutomation(
  event: Readonly<Record<string, unknown>>,
  eventType: string,
): Record<string, unknown> {
  if (eventType !== "slack:message" && eventType !== "slack:app_mention") {
    return cloneSlackRecord(event);
  }

  const threadRootTimestamp =
    resolveOptionalSlackStringField(event, "thread_ts") ??
    resolveOptionalSlackStringField(event, "ts");
  if (threadRootTimestamp === undefined) {
    return cloneSlackRecord(event);
  }

  const existingThreadRootTimestamp = resolveOptionalSlackStringField(
    event,
    SlackThreadRootTimestampField,
  );
  if (existingThreadRootTimestamp === threadRootTimestamp) {
    return cloneSlackRecord(event);
  }

  return {
    ...cloneSlackRecord(event),
    [SlackThreadRootTimestampField]: threadRootTimestamp,
  };
}

function resolveSlackReactionItem(input: Readonly<Record<string, unknown>>): {
  channel: string;
  ts: string;
} {
  const item = input.item;
  if (typeof item !== "object" || item === null || Array.isArray(item)) {
    throw new Error("Slack reaction event is missing item.");
  }

  const normalizedItem = cloneSlackRecord(item);
  const itemType = resolveOptionalSlackStringField(normalizedItem, "type");
  if (itemType !== "message") {
    throw new Error(`Slack reaction item type '${itemType ?? "unknown"}' is not supported.`);
  }

  const channel = resolveOptionalSlackStringField(normalizedItem, "channel");
  if (channel === undefined) {
    throw new Error("Slack reaction event is missing item.channel.");
  }

  const ts = resolveOptionalSlackStringField(normalizedItem, "ts");
  if (ts === undefined) {
    throw new Error("Slack reaction event is missing item.ts.");
  }

  return {
    channel,
    ts,
  };
}

function buildSlackConversationsRepliesUrl(input: {
  apiBaseUrl: string;
  channel: string;
  ts: string;
}): URL {
  const apiUrl = new URL(input.apiBaseUrl);
  apiUrl.pathname = `${apiUrl.pathname === "/" ? "" : apiUrl.pathname}/${SlackConversationsRepliesPath}`;
  apiUrl.searchParams.set("channel", input.channel);
  apiUrl.searchParams.set("ts", input.ts);
  return apiUrl;
}

async function fetchSlackConversationThreadRootTimestamp(input: {
  apiBaseUrl: string;
  botToken: string;
  channel: string;
  ts: string;
}): Promise<string> {
  const response = await fetch(buildSlackConversationsRepliesUrl(input), {
    method: "GET",
    headers: {
      authorization: `Bearer ${input.botToken}`,
      accept: "application/json",
    },
  });
  if (!response.ok) {
    throw new Error(
      `Slack conversations.replies request failed with status ${String(response.status)}.`,
    );
  }

  const payload: unknown = await response.json();
  if (typeof payload !== "object" || payload === null || Array.isArray(payload)) {
    throw new Error("Slack conversations.replies response must be a JSON object.");
  }

  const normalizedPayload = cloneSlackRecord(payload);
  if (normalizedPayload.ok !== true) {
    const slackError = resolveOptionalSlackStringField(normalizedPayload, "error");
    throw new Error(
      `Slack conversations.replies returned an error${slackError === undefined ? "." : `: ${slackError}.`}`,
    );
  }

  const messages = normalizedPayload.messages;
  if (!Array.isArray(messages)) {
    throw new Error("Slack conversations.replies response is missing messages.");
  }

  const reactedMessage = messages.find((message): message is Record<string, unknown> => {
    if (typeof message !== "object" || message === null || Array.isArray(message)) {
      return false;
    }

    const normalizedMessage = cloneSlackRecord(message);
    return resolveOptionalSlackStringField(normalizedMessage, "ts") === input.ts;
  });
  if (reactedMessage === undefined) {
    throw new Error(
      `Slack conversations.replies did not return message '${input.ts}' for channel '${input.channel}'.`,
    );
  }

  const threadRootTimestamp =
    resolveOptionalSlackStringField(reactedMessage, "thread_ts") ??
    resolveOptionalSlackStringField(reactedMessage, "ts");
  if (threadRootTimestamp === undefined) {
    throw new Error("Slack replied message is missing ts.");
  }

  return threadRootTimestamp;
}

async function enrichSlackReactionEvent(input: {
  event: IntegrationWebhookEvent;
  target: {
    config: SlackTargetConfig;
  };
  connectionSecrets: SlackWebhookConnectionSecrets;
}): Promise<IntegrationWebhookEvent> {
  const botToken = input.connectionSecrets.botToken;
  if (typeof botToken !== "string" || botToken.length === 0) {
    throw new Error("Slack bot token is missing for reaction event enrichment.");
  }

  const rawEvent = input.event.payload.event;
  if (typeof rawEvent !== "object" || rawEvent === null || Array.isArray(rawEvent)) {
    throw new Error("Slack reaction webhook payload is missing event.");
  }

  const normalizedEvent = cloneSlackRecord(rawEvent);
  const reactionItem = resolveSlackReactionItem(normalizedEvent);
  const threadRootTimestamp = await fetchSlackConversationThreadRootTimestamp({
    apiBaseUrl: input.target.config.apiBaseUrl,
    botToken,
    channel: reactionItem.channel,
    ts: reactionItem.ts,
  });

  return {
    ...input.event,
    payload: {
      ...input.event.payload,
      event: {
        ...normalizedEvent,
        channel: reactionItem.channel,
        [SlackThreadRootTimestampField]: threadRootTimestamp,
      },
    },
  };
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
  SlackWebhookConnectionSecrets
> = {
  resolveWebhookRequest(input) {
    const rawPayload = parseSlackJsonPayload(input.rawBody);
    const requestType = resolveSlackRequestType(rawPayload);

    if (requestType === "url_verification") {
      const challenge = rawPayload.challenge;
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
          payload: rawPayload,
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

    const rawEvent = resolveSlackEnvelopeEvent(rawPayload);
    const rawProviderEventType = resolveSlackProviderEventTypeFromEvent(rawEvent);
    const classification = resolveSlackEventClassification({
      rawProviderEventType,
      event: rawEvent,
    });
    const normalizedEventPayload = enrichSlackEventForAutomation(
      rawEvent,
      classification.eventType,
    );
    const payload = {
      ...rawPayload,
      event: normalizedEventPayload,
    };
    const event: IntegrationWebhookEvent = {
      externalEventId: resolveSlackExternalEventId(rawPayload),
      providerEventType: classification.providerEventType,
      eventType: classification.eventType,
      payload,
    };
    const occurredAt = resolveSlackOccurredAt(rawPayload);
    if (occurredAt !== undefined) {
      event.occurredAt = occurredAt;
    }
    const sourceOrderKey = resolveSlackSourceOrderKey(rawPayload);
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
  async enrichEvent(input) {
    if (
      input.event.eventType !== "slack:reaction_added" &&
      input.event.eventType !== "slack:reaction_removed"
    ) {
      return input.event;
    }

    return enrichSlackReactionEvent({
      event: input.event,
      target: input.target,
      connectionSecrets: input.connectionSecrets,
    });
  },
};
