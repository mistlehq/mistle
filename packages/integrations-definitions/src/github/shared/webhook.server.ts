import {
  createIntegrationWebhookSourceOrderKey,
  type IntegrationWebhookHandler,
  type IntegrationWebhookResolveConnectionResult,
  type IntegrationWebhookVerifyResult,
} from "@mistle/integrations-core";
import { verify } from "@octokit/webhooks-methods";

import { GitHubFamilyId } from "./constants.js";
import type { GitHubTargetConfig } from "./target-config-schema.js";
import type { GitHubTargetSecrets } from "./target-secret-schema.js";

const GitHubWebhookEventHeaderName = "x-github-event";
const GitHubWebhookDeliveryHeaderName = "x-github-delivery";
const GitHubWebhookSignatureHeaderName = "x-hub-signature-256";

function isRecord(input: unknown): input is Record<string, unknown> {
  return typeof input === "object" && input !== null;
}

function decodeRawBody(input: Uint8Array): string {
  return new TextDecoder().decode(input);
}

function resolveHeaderValue(input: {
  headers: Readonly<Record<string, string>>;
  name: string;
}): string | undefined {
  const directValue = input.headers[input.name];
  if (directValue !== undefined) {
    return directValue;
  }

  const headerName = input.name.toLowerCase();
  for (const [candidateName, candidateValue] of Object.entries(input.headers)) {
    if (candidateName.toLowerCase() === headerName) {
      return candidateValue;
    }
  }

  return undefined;
}

function parseJsonPayload(input: Uint8Array): Record<string, unknown> {
  const decodedBody = decodeRawBody(input);
  let parsedPayload: unknown;

  try {
    parsedPayload = JSON.parse(decodedBody);
  } catch {
    throw new Error("GitHub webhook payload must be valid JSON.");
  }

  if (!isRecord(parsedPayload)) {
    throw new Error("GitHub webhook payload must be a JSON object.");
  }

  return parsedPayload;
}

function resolveProviderEventType(input: Readonly<Record<string, string>>): string {
  const eventTypeHeader = resolveHeaderValue({
    headers: input,
    name: GitHubWebhookEventHeaderName,
  });

  if (eventTypeHeader === undefined || eventTypeHeader.trim().length === 0) {
    throw new Error("GitHub webhook is missing x-github-event header.");
  }

  return eventTypeHeader.trim();
}

function resolveDeliveryId(input: Readonly<Record<string, string>>): string {
  const deliveryIdHeader = resolveHeaderValue({
    headers: input,
    name: GitHubWebhookDeliveryHeaderName,
  });

  if (deliveryIdHeader === undefined || deliveryIdHeader.trim().length === 0) {
    throw new Error("GitHub webhook is missing x-github-delivery header.");
  }

  return deliveryIdHeader.trim();
}

function resolveInstallationId(input: Record<string, unknown>): string {
  const installation = input.installation;

  if (!isRecord(installation)) {
    throw new Error("GitHub webhook payload is missing installation context.");
  }

  const installationId = installation.id;
  if (typeof installationId === "number") {
    return installationId.toString();
  }

  if (typeof installationId === "string" && installationId.trim().length > 0) {
    return installationId.trim();
  }

  throw new Error("GitHub webhook payload is missing installation.id.");
}

function resolveAction(input: Record<string, unknown>): string {
  const action = input.action;

  if (typeof action === "string" && action.trim().length > 0) {
    return action.trim();
  }

  return "unknown";
}

function resolveCanonicalAction(input: {
  providerEventType: string;
  payload: Record<string, unknown>;
}): string {
  const action = resolveAction(input.payload);
  if (action !== "unknown") {
    return action;
  }

  if (input.providerEventType === "push") {
    return "pushed";
  }

  return action;
}

function resolveNumericIdentifier(input: Record<string, unknown>, key: string): string | null {
  const value = input[key];
  if (typeof value === "number" && Number.isInteger(value) && value >= 0) {
    return value.toString().padStart(20, "0");
  }

  if (typeof value === "string" && value.trim().length > 0) {
    const normalizedValue = value.trim();
    return /^\d+$/u.test(normalizedValue) ? normalizedValue.padStart(20, "0") : normalizedValue;
  }

  return null;
}

function resolveTimestampField(input: Record<string, unknown>, key: string): string | null {
  const value = input[key];
  if (typeof value !== "string" || value.trim().length === 0) {
    return null;
  }

  const normalizedValue = value.trim();
  return Number.isNaN(Date.parse(normalizedValue)) ? null : normalizedValue;
}

type GitHubEventOrdering = {
  occurredAt: string;
  sourceOrderKey: string;
};

function requireRecordField(input: {
  payload: Record<string, unknown>;
  key: string;
  eventType: string;
}): Record<string, unknown> {
  const value = input.payload[input.key];
  if (isRecord(value)) {
    return value;
  }

  throw new Error(`GitHub webhook event '${input.eventType}' is missing payload.${input.key}.`);
}

function requireTimestampField(input: {
  record: Record<string, unknown>;
  key: string;
  eventType: string;
}): string {
  const timestamp = resolveTimestampField(input.record, input.key);
  if (timestamp !== null) {
    return timestamp;
  }

  throw new Error(
    `GitHub webhook event '${input.eventType}' is missing timestamp field '${input.key}'.`,
  );
}

function requireOrderingIdentifier(input: {
  record: Record<string, unknown>;
  key: string;
  eventType: string;
}): string {
  const identifier = resolveNumericIdentifier(input.record, input.key);
  if (identifier !== null) {
    return identifier;
  }

  throw new Error(
    `GitHub webhook event '${input.eventType}' is missing ordering identifier '${input.key}'.`,
  );
}

function requireStringField(input: {
  record: Record<string, unknown>;
  key: string;
  eventType: string;
}): string {
  const value = input.record[input.key];
  if (typeof value === "string" && value.trim().length > 0) {
    return value.trim();
  }

  throw new Error(
    `GitHub webhook event '${input.eventType}' is missing string field '${input.key}'.`,
  );
}

function resolveRecordOrdering(input: {
  record: Record<string, unknown>;
  timestampField: string;
  identifierField: string;
  eventType: string;
}): GitHubEventOrdering {
  const occurredAt = requireTimestampField({
    record: input.record,
    key: input.timestampField,
    eventType: input.eventType,
  });
  const orderingIdentifier = requireOrderingIdentifier({
    record: input.record,
    key: input.identifierField,
    eventType: input.eventType,
  });

  return {
    occurredAt,
    sourceOrderKey: createIntegrationWebhookSourceOrderKey({
      occurredAt,
      orderingIdentifier,
    }),
  };
}

function resolvePayloadRecordOrdering(input: {
  payload: Record<string, unknown>;
  payloadKey: string;
  timestampField: string;
  identifierField: string;
  eventType: string;
}): GitHubEventOrdering {
  return resolveRecordOrdering({
    record: requireRecordField({
      payload: input.payload,
      key: input.payloadKey,
      eventType: input.eventType,
    }),
    timestampField: input.timestampField,
    identifierField: input.identifierField,
    eventType: input.eventType,
  });
}

function resolvePushOrdering(input: {
  payload: Record<string, unknown>;
  eventType: string;
}): GitHubEventOrdering {
  const headCommit = requireRecordField({
    payload: input.payload,
    key: "head_commit",
    eventType: input.eventType,
  });
  const occurredAt = requireTimestampField({
    record: headCommit,
    key: "timestamp",
    eventType: input.eventType,
  });
  const orderingIdentifier = requireStringField({
    record: input.payload,
    key: "after",
    eventType: input.eventType,
  });

  return {
    occurredAt,
    sourceOrderKey: createIntegrationWebhookSourceOrderKey({
      occurredAt,
      orderingIdentifier,
    }),
  };
}

function resolveGitHubEventOrdering(input: {
  eventType: string;
  payload: Record<string, unknown>;
}): GitHubEventOrdering | undefined {
  switch (input.eventType) {
    case "github.issues.opened":
      return resolvePayloadRecordOrdering({
        payload: input.payload,
        payloadKey: "issue",
        timestampField: "created_at",
        identifierField: "id",
        eventType: input.eventType,
      });
    case "github.issues.closed":
      return resolvePayloadRecordOrdering({
        payload: input.payload,
        payloadKey: "issue",
        timestampField: "closed_at",
        identifierField: "id",
        eventType: input.eventType,
      });
    case "github.issues.reopened":
      return resolvePayloadRecordOrdering({
        payload: input.payload,
        payloadKey: "issue",
        timestampField: "updated_at",
        identifierField: "id",
        eventType: input.eventType,
      });
    case "github.issue_comment.created":
      return resolvePayloadRecordOrdering({
        payload: input.payload,
        payloadKey: "comment",
        timestampField: "created_at",
        identifierField: "id",
        eventType: input.eventType,
      });
    case "github.pull_request.opened":
      return resolvePayloadRecordOrdering({
        payload: input.payload,
        payloadKey: "pull_request",
        timestampField: "created_at",
        identifierField: "id",
        eventType: input.eventType,
      });
    case "github.pull_request.closed":
      return resolvePayloadRecordOrdering({
        payload: input.payload,
        payloadKey: "pull_request",
        timestampField: "closed_at",
        identifierField: "id",
        eventType: input.eventType,
      });
    case "github.pull_request.reopened":
      return resolvePayloadRecordOrdering({
        payload: input.payload,
        payloadKey: "pull_request",
        timestampField: "updated_at",
        identifierField: "id",
        eventType: input.eventType,
      });
    case "github.pull_request.synchronize": {
      const pullRequest = requireRecordField({
        payload: input.payload,
        key: "pull_request",
        eventType: input.eventType,
      });
      const occurredAt = requireTimestampField({
        record: pullRequest,
        key: "updated_at",
        eventType: input.eventType,
      });
      const orderingIdentifier = requireStringField({
        record: input.payload,
        key: "after",
        eventType: input.eventType,
      });

      return {
        occurredAt,
        sourceOrderKey: createIntegrationWebhookSourceOrderKey({
          occurredAt,
          orderingIdentifier,
        }),
      };
    }
    case "github.pull_request_review.submitted":
      return resolvePayloadRecordOrdering({
        payload: input.payload,
        payloadKey: "review",
        timestampField: "submitted_at",
        identifierField: "id",
        eventType: input.eventType,
      });
    case "github.pull_request_review_comment.created":
      return resolvePayloadRecordOrdering({
        payload: input.payload,
        payloadKey: "comment",
        timestampField: "created_at",
        identifierField: "id",
        eventType: input.eventType,
      });
    case "github.push.pushed":
      return resolvePushOrdering(input);
    case "github.check_suite.completed":
      return resolvePayloadRecordOrdering({
        payload: input.payload,
        payloadKey: "check_suite",
        timestampField: "updated_at",
        identifierField: "id",
        eventType: input.eventType,
      });
    default:
      return undefined;
  }
}

function sanitizeEventSegment(input: string): string {
  return input
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_.-]/g, "_");
}

function resolveEventType(input: { providerEventType: string; action: string }): string {
  const providerEventType = sanitizeEventSegment(input.providerEventType);
  const action = sanitizeEventSegment(input.action);

  return `${GitHubFamilyId}.${providerEventType}.${action}`;
}

async function verifyGitHubSignature(input: {
  secret: string;
  payload: string;
  signature: string;
}): Promise<IntegrationWebhookVerifyResult> {
  const isValidSignature = await verify(input.secret, input.payload, input.signature);
  if (isValidSignature) {
    return {
      ok: true,
    };
  }

  return {
    ok: false,
    code: "invalid-signature",
    message: "GitHub webhook signature verification failed.",
  };
}

export const GitHubWebhookHandler: IntegrationWebhookHandler<
  GitHubTargetConfig,
  GitHubTargetSecrets,
  {
    webhookSecret?: string;
  }
> = {
  resolveWebhookRequest(input) {
    const payload = parseJsonPayload(input.rawBody);
    const providerEventType = resolveProviderEventType(input.headers);
    const action = resolveCanonicalAction({ providerEventType, payload });
    const eventType = resolveEventType({
      providerEventType,
      action,
    });
    const deliveryId = resolveDeliveryId(input.headers);
    resolveInstallationId(payload);
    const ordering = resolveGitHubEventOrdering({
      eventType,
      payload,
    });

    return {
      kind: "event",
      event: {
        externalEventId: deliveryId,
        externalDeliveryId: deliveryId,
        providerEventType,
        eventType,
        payload,
        ...(ordering === undefined ? {} : { occurredAt: ordering.occurredAt }),
        ...(ordering === undefined ? {} : { sourceOrderKey: ordering.sourceOrderKey }),
      },
    };
  },
  resolveConnection(input): IntegrationWebhookResolveConnectionResult {
    const installationId = resolveInstallationId(input.event.payload);
    if (input.candidates.length === 0) {
      return {
        ok: false,
        code: "connection-not-found",
        message: `No active connection found for GitHub installation '${installationId}'.`,
      };
    }

    if (input.candidates.length > 1) {
      return {
        ok: false,
        code: "connection-ambiguous",
        message: `Multiple active connections found for GitHub installation '${installationId}'.`,
      };
    }

    const [resolvedConnection] = input.candidates;
    if (resolvedConnection === undefined) {
      return {
        ok: false,
        code: "invalid-connection",
        message: `Failed to resolve connection for GitHub installation '${installationId}'.`,
      };
    }

    if (resolvedConnection.externalSubjectId === undefined) {
      return {
        ok: false,
        code: "invalid-connection",
        message: `GitHub connection '${resolvedConnection.id}' is missing installation context.`,
      };
    }

    if (resolvedConnection.externalSubjectId !== installationId) {
      return {
        ok: false,
        code: "invalid-connection",
        message: `GitHub webhook installation '${installationId}' does not match connection '${resolvedConnection.id}'.`,
      };
    }

    return {
      ok: true,
      connectionId: resolvedConnection.id,
    };
  },
  async verify(input) {
    const webhookSecret = input.connectionSecrets.webhookSecret;
    if (webhookSecret === undefined || webhookSecret.length === 0) {
      return {
        ok: false,
        code: "invalid-body",
        message: "GitHub connection secrets are missing webhookSecret.",
      };
    }

    const signature = resolveHeaderValue({
      headers: input.headers,
      name: GitHubWebhookSignatureHeaderName,
    });
    if (signature === undefined || signature.trim().length === 0) {
      return {
        ok: false,
        code: "invalid-headers",
        message: "GitHub webhook is missing x-hub-signature-256 header.",
      };
    }

    try {
      return await verifyGitHubSignature({
        secret: webhookSecret,
        payload: decodeRawBody(input.rawBody),
        signature: signature.trim(),
      });
    } catch {
      return {
        ok: false,
        code: "invalid-signature",
        message: "GitHub webhook signature verification failed.",
      };
    }
  },
};
