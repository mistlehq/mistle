import { createHmac, timingSafeEqual } from "node:crypto";

import {
  createIntegrationWebhookSourceOrderKey,
  type IntegrationConnection,
  type IntegrationWebhookEvent,
  type IntegrationWebhookHandler,
  type IntegrationWebhookResolveConnectionResult,
  type IntegrationWebhookVerifyResult,
} from "@mistle/integrations-core";
import { z } from "zod";

import type { LinearTargetConfig } from "./target-config-schema.js";

const LinearDeliveryHeaderName = "linear-delivery";
const LinearEventHeaderName = "linear-event";
const LinearSignatureHeaderName = "linear-signature";
const LinearWebhookTimestampToleranceMs = 60_000;

const LinearResourceTypeByProviderType: ReadonlyMap<string, string> = new Map([
  ["Issue", "issue"],
  ["Comment", "comment"],
  ["IssueLabel", "issue_label"],
  ["Project", "project"],
  ["Cycle", "cycle"],
  ["Reaction", "reaction"],
]);

const LinearActionByProviderAction: ReadonlyMap<string, string> = new Map([
  ["create", "created"],
  ["update", "updated"],
  ["remove", "removed"],
]);

type LinearAssignmentChange = {
  changed: boolean;
  previousUserId?: string;
  currentUserId?: string;
};

const LinearWebhookPayloadObjectSchema = z.record(z.string(), z.unknown());

function parseLinearJsonPayload(input: Uint8Array): Record<string, unknown> {
  const decodedBody = new TextDecoder().decode(input);
  let parsedPayload: unknown;

  try {
    parsedPayload = JSON.parse(decodedBody);
  } catch {
    throw new Error("Linear webhook payload must be valid JSON.");
  }

  const payloadResult = LinearWebhookPayloadObjectSchema.safeParse(parsedPayload);
  if (!payloadResult.success) {
    throw new Error("Linear webhook payload must be a JSON object.");
  }

  return payloadResult.data;
}

function resolveStringField(input: Readonly<Record<string, unknown>>, key: string): string {
  const value = input[key];
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`Linear webhook payload is missing ${key}.`);
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

function resolveHeader(input: Readonly<Record<string, string>>, headerName: string): string {
  const value = input[headerName];
  if (value === undefined || value.trim().length === 0) {
    throw new Error(`Linear webhook is missing ${headerName} header.`);
  }

  return value.trim();
}

function resolveProviderResourceType(input: {
  headers: Readonly<Record<string, string>>;
  payload: Record<string, unknown>;
}): string {
  const payloadType = resolveStringField(input.payload, "type");
  const headerType = input.headers[LinearEventHeaderName]?.trim();
  if (headerType !== undefined && headerType.length > 0 && headerType !== payloadType) {
    throw new Error(
      `Linear webhook header event '${headerType}' does not match payload type '${payloadType}'.`,
    );
  }

  return payloadType;
}

function resolveLinearEventClassification(input: {
  providerResourceType: string;
  providerAction: string;
}): { providerEventType: string; eventType: string } {
  const normalizedResourceType = LinearResourceTypeByProviderType.get(input.providerResourceType);
  if (normalizedResourceType === undefined) {
    throw new Error(
      `Linear webhook resource type '${input.providerResourceType}' is not supported.`,
    );
  }

  const normalizedAction = LinearActionByProviderAction.get(input.providerAction);
  if (normalizedAction === undefined) {
    throw new Error(`Linear webhook action '${input.providerAction}' is not supported.`);
  }

  return {
    providerEventType: input.providerResourceType,
    eventType: `linear.${normalizedResourceType}.${normalizedAction}`,
  };
}

function resolveLinearOccurredAt(payload: Record<string, unknown>): string | undefined {
  const createdAt = payload.createdAt;
  if (typeof createdAt !== "string" || createdAt.trim().length === 0) {
    return undefined;
  }

  const timestampMs = Date.parse(createdAt);
  if (!Number.isFinite(timestampMs)) {
    return undefined;
  }

  return new Date(timestampMs).toISOString();
}

function resolveLinearOrderingIdentifier(input: {
  deliveryId: string;
  payload: Record<string, unknown>;
}): string {
  const webhookId = resolveOptionalStringField(input.payload, "webhookId");
  if (webhookId !== undefined) {
    return `${webhookId}:${input.deliveryId}`;
  }

  const data = input.payload.data;
  const dataResult = LinearWebhookPayloadObjectSchema.safeParse(data);
  if (dataResult.success) {
    const dataId = resolveOptionalStringField(dataResult.data, "id");
    if (dataId !== undefined) {
      return `${dataId}:${input.deliveryId}`;
    }
  }

  return input.deliveryId;
}

function resolveLinearSourceOrderKey(input: {
  deliveryId: string;
  payload: Record<string, unknown>;
}): string | undefined {
  const occurredAt = resolveLinearOccurredAt(input.payload);
  if (occurredAt === undefined) {
    return undefined;
  }

  return createIntegrationWebhookSourceOrderKey({
    occurredAt,
    orderingIdentifier: resolveLinearOrderingIdentifier(input),
  });
}

function resolvePathRoutedConnection(
  candidates: ReadonlyArray<IntegrationConnection>,
): IntegrationWebhookResolveConnectionResult {
  const candidate = candidates[0];
  if (candidate === undefined) {
    return {
      ok: false,
      code: "connection-not-found",
      message: "No active Linear connection matched the webhook source.",
    };
  }

  if (candidates.length > 1) {
    return {
      ok: false,
      code: "connection-ambiguous",
      message: "Multiple active Linear connections matched the webhook source.",
    };
  }

  return {
    ok: true,
    connectionId: candidate.id,
  };
}

export function buildLinearWebhookSignature(input: {
  webhookSecret: string;
  rawBody: Uint8Array;
}): string {
  return createHmac("sha256", input.webhookSecret).update(input.rawBody).digest("hex");
}

function verifyLinearTimestamp(input: {
  payload: Record<string, unknown>;
  nowMs: number;
}): IntegrationWebhookVerifyResult {
  const webhookTimestamp = input.payload.webhookTimestamp;
  if (typeof webhookTimestamp !== "number" || !Number.isInteger(webhookTimestamp)) {
    return {
      ok: false,
      code: "invalid-body",
      message: "Linear webhook payload is missing integer webhookTimestamp.",
    };
  }

  const ageMs = Math.abs(input.nowMs - webhookTimestamp);
  if (ageMs > LinearWebhookTimestampToleranceMs) {
    return {
      ok: false,
      code: "invalid-signature",
      message: "Linear webhook timestamp is outside the accepted tolerance window.",
    };
  }

  return { ok: true };
}

export function verifyLinearWebhookSignature(input: {
  webhookSecret: string;
  signature: string;
  rawBody: Uint8Array;
  payload: Record<string, unknown>;
  nowMs?: number;
}): IntegrationWebhookVerifyResult {
  if (!/^[0-9a-f]+$/i.test(input.signature) || input.signature.length % 2 !== 0) {
    return {
      ok: false,
      code: "invalid-signature",
      message: "Linear signature header must be hex-encoded.",
    };
  }

  const expectedSignature = buildLinearWebhookSignature({
    webhookSecret: input.webhookSecret,
    rawBody: input.rawBody,
  });
  const expectedBytes = Buffer.from(expectedSignature, "hex");
  const actualBytes = Buffer.from(input.signature, "hex");
  if (expectedBytes.length !== actualBytes.length || !timingSafeEqual(expectedBytes, actualBytes)) {
    return {
      ok: false,
      code: "invalid-signature",
      message: "Linear webhook signature verification failed.",
    };
  }

  return verifyLinearTimestamp({
    payload: input.payload,
    nowMs: input.nowMs ?? Date.now(),
  });
}

function resolveChangedFields(payload: Record<string, unknown>): readonly string[] {
  const updatedFromResult = LinearWebhookPayloadObjectSchema.safeParse(payload.updatedFrom);
  if (!updatedFromResult.success) {
    return [];
  }

  return Object.keys(updatedFromResult.data).sort();
}

function resolveLinearUserId(value: unknown): string | undefined {
  if (typeof value === "string" && value.trim().length > 0) {
    return value.trim();
  }

  const valueResult = LinearWebhookPayloadObjectSchema.safeParse(value);
  if (!valueResult.success) {
    return undefined;
  }

  return resolveOptionalStringField(valueResult.data, "id");
}

function resolveCurrentAssigneeId(data: Record<string, unknown>): string | undefined {
  return resolveOptionalStringField(data, "assigneeId") ?? resolveLinearUserId(data.assignee);
}

function resolvePreviousAssigneeId(updatedFrom: Record<string, unknown>): string | undefined {
  return (
    resolveOptionalStringField(updatedFrom, "assigneeId") ??
    resolveLinearUserId(updatedFrom.assignee)
  );
}

function resolveAssignmentChange(payload: Record<string, unknown>): LinearAssignmentChange {
  const updatedFromResult = LinearWebhookPayloadObjectSchema.safeParse(payload.updatedFrom);
  const dataResult = LinearWebhookPayloadObjectSchema.safeParse(payload.data);
  if (!updatedFromResult.success || !dataResult.success) {
    return { changed: false };
  }
  const updatedFrom = updatedFromResult.data;
  const data = dataResult.data;

  if (!("assigneeId" in updatedFrom) && !("assignee" in updatedFrom)) {
    return { changed: false };
  }

  const previousUserId = resolvePreviousAssigneeId(updatedFrom);
  const currentUserId = resolveCurrentAssigneeId(data);
  return {
    changed: true,
    ...(previousUserId === undefined ? {} : { previousUserId }),
    ...(currentUserId === undefined ? {} : { currentUserId }),
  };
}

function enrichLinearUpdateEvent(event: IntegrationWebhookEvent): IntegrationWebhookEvent {
  if (!event.eventType.endsWith(".updated")) {
    return event;
  }

  const mistle = {
    changedFields: resolveChangedFields(event.payload),
    ...(event.eventType === "linear.issue.updated"
      ? { assignment: resolveAssignmentChange(event.payload) }
      : {}),
  };

  return {
    ...event,
    payload: {
      ...event.payload,
      mistle,
    },
  };
}

export const LinearWebhookHandler: IntegrationWebhookHandler<
  LinearTargetConfig,
  Record<string, never>,
  Record<string, string>
> = {
  resolveWebhookRequest(input) {
    const payload = parseLinearJsonPayload(input.rawBody);
    const deliveryId = resolveHeader(input.headers, LinearDeliveryHeaderName);
    const providerResourceType = resolveProviderResourceType({
      headers: input.headers,
      payload,
    });
    const providerAction = resolveStringField(payload, "action");
    const classification = resolveLinearEventClassification({
      providerResourceType,
      providerAction,
    });
    const event: IntegrationWebhookEvent = {
      externalEventId: deliveryId,
      externalDeliveryId: deliveryId,
      providerEventType: classification.providerEventType,
      eventType: classification.eventType,
      payload,
    };
    const occurredAt = resolveLinearOccurredAt(payload);
    if (occurredAt !== undefined) {
      event.occurredAt = occurredAt;
    }
    const sourceOrderKey = resolveLinearSourceOrderKey({
      deliveryId,
      payload,
    });
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
    const webhookSecret = input.webhookSourceSecrets.webhookSecret;
    if (webhookSecret === undefined || webhookSecret.length === 0) {
      return {
        ok: false,
        code: "invalid-body",
        message: "Linear webhook secret is missing for this source.",
      };
    }

    let signature: string;
    try {
      signature = resolveHeader(input.headers, LinearSignatureHeaderName);
    } catch (error) {
      return {
        ok: false,
        code: "invalid-headers",
        message: error instanceof Error ? error.message : "Linear headers are invalid.",
      };
    }

    return verifyLinearWebhookSignature({
      webhookSecret,
      signature,
      rawBody: input.rawBody,
      payload: input.event.payload,
    });
  },
  enrichEvent(input) {
    return enrichLinearUpdateEvent(input.event);
  },
};
