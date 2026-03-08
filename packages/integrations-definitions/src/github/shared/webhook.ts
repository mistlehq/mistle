import type {
  IntegrationWebhookHandler,
  IntegrationWebhookResolveConnectionResult,
  IntegrationWebhookVerifyResult,
} from "@mistle/integrations-core";
import { verify } from "@octokit/webhooks-methods";

import { GitHubFamilyId } from "./constants.js";
import type { GitHubTargetConfig } from "./target-config-schema.js";
import type { GitHubTargetSecrets } from "./target-secret-schema.js";

const GitHubWebhookEventHeaderName = "x-github-event";
const GitHubWebhookDeliveryHeaderName = "x-github-delivery";
const GitHubWebhookSignatureHeaderName = "x-hub-signature-256";
const GitHubIssueCommentProviderEventType = "issue_comment";
const GitHubPullRequestProviderEventType = "pull_request";
const GitHubPullRequestReviewCommentProviderEventType = "pull_request_review_comment";

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

function resolveRecordField(input: {
  payload: Record<string, unknown>;
  field: string;
  errorMessage: string;
}): Record<string, unknown> {
  const value = input.payload[input.field];
  if (!isRecord(value)) {
    throw new Error(input.errorMessage);
  }

  return value;
}

function resolveTimestampField(input: {
  record: Record<string, unknown>;
  field: string;
  errorMessage: string;
}): string {
  const value = input.record[input.field];
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(input.errorMessage);
  }

  return value;
}

function resolveNumericIdentifier(input: { value: unknown; errorMessage: string }): string {
  if (typeof input.value === "number" && Number.isInteger(input.value) && input.value >= 0) {
    return input.value.toString();
  }

  if (typeof input.value === "string" && /^\d+$/.test(input.value.trim())) {
    return input.value.trim();
  }

  throw new Error(input.errorMessage);
}

function buildSourceMetadata(input: {
  record: Record<string, unknown>;
  timestampField: string;
  timestampErrorMessage: string;
  identifierErrorMessage: string;
}): {
  occurredAt: string;
  sourceOrderKey: string;
} {
  const occurredAt = resolveTimestampField({
    record: input.record,
    field: input.timestampField,
    errorMessage: input.timestampErrorMessage,
  });
  const normalizedIdentifier = resolveNumericIdentifier({
    value: input.record.id,
    errorMessage: input.identifierErrorMessage,
  });

  return {
    occurredAt,
    sourceOrderKey: `${occurredAt}#${normalizedIdentifier.padStart(20, "0")}`,
  };
}

function resolveIssueCommentTimestampField(action: string): string {
  switch (action) {
    case "created":
      return "created_at";
    case "edited":
    case "deleted":
      return "updated_at";
    default:
      throw new Error(
        `GitHub issue_comment action '${action}' does not expose deterministic source ordering metadata.`,
      );
  }
}

function resolveIssueCommentMetadata(input: { payload: Record<string, unknown>; action: string }): {
  occurredAt: string;
  sourceOrderKey: string;
} {
  const comment = resolveRecordField({
    payload: input.payload,
    field: "comment",
    errorMessage: "GitHub issue comment webhook payload is missing comment context.",
  });

  const timestampField = resolveIssueCommentTimestampField(input.action);
  return buildSourceMetadata({
    record: comment,
    timestampField,
    timestampErrorMessage: `GitHub issue comment webhook payload is missing comment.${timestampField}.`,
    identifierErrorMessage: "GitHub issue comment webhook payload is missing a numeric comment.id.",
  });
}

function resolvePullRequestReviewCommentMetadata(input: {
  payload: Record<string, unknown>;
  action: string;
}): {
  occurredAt: string;
  sourceOrderKey: string;
} {
  const comment = resolveRecordField({
    payload: input.payload,
    field: "comment",
    errorMessage: "GitHub pull request review comment webhook payload is missing comment context.",
  });

  const timestampField =
    input.action === "created"
      ? "created_at"
      : input.action === "edited" || input.action === "deleted"
        ? "updated_at"
        : null;
  if (timestampField === null) {
    throw new Error(
      `GitHub pull_request_review_comment action '${input.action}' does not expose deterministic source ordering metadata.`,
    );
  }

  return buildSourceMetadata({
    record: comment,
    timestampField,
    timestampErrorMessage: `GitHub pull request review comment webhook payload is missing comment.${timestampField}.`,
    identifierErrorMessage:
      "GitHub pull request review comment webhook payload is missing a numeric comment.id.",
  });
}

function resolvePullRequestMetadata(input: { payload: Record<string, unknown>; action: string }): {
  occurredAt: string;
  sourceOrderKey: string;
} {
  const pullRequest = resolveRecordField({
    payload: input.payload,
    field: "pull_request",
    errorMessage: "GitHub pull request webhook payload is missing pull_request context.",
  });

  const timestampField = input.action === "opened" ? "created_at" : "updated_at";
  return buildSourceMetadata({
    record: pullRequest,
    timestampField,
    timestampErrorMessage: `GitHub pull request webhook payload is missing pull_request.${timestampField}.`,
    identifierErrorMessage:
      "GitHub pull request webhook payload is missing a numeric pull_request.id.",
  });
}

function resolveSourceMetadata(input: {
  payload: Record<string, unknown>;
  providerEventType: string;
  action: string;
}): {
  occurredAt: string;
  sourceOrderKey: string;
} | null {
  switch (input.providerEventType) {
    case GitHubIssueCommentProviderEventType:
      return resolveIssueCommentMetadata({
        payload: input.payload,
        action: input.action,
      });
    case GitHubPullRequestReviewCommentProviderEventType:
      return resolvePullRequestReviewCommentMetadata({
        payload: input.payload,
        action: input.action,
      });
    case GitHubPullRequestProviderEventType:
      return resolvePullRequestMetadata({
        payload: input.payload,
        action: input.action,
      });
    default:
      return null;
  }
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
  Record<string, string>
> = {
  resolveConnection(input): IntegrationWebhookResolveConnectionResult {
    const installationId = resolveInstallationId(input.event.payload);
    const matchingCandidates = input.candidates.filter(
      (candidateConnection) => candidateConnection.externalSubjectId === installationId,
    );

    if (matchingCandidates.length === 0) {
      return {
        ok: false,
        code: "connection-not-found",
        message: `No active connection found for GitHub installation '${installationId}'.`,
      };
    }

    if (matchingCandidates.length > 1) {
      return {
        ok: false,
        code: "connection-ambiguous",
        message: `Multiple active connections found for GitHub installation '${installationId}'.`,
      };
    }

    const [resolvedConnection] = matchingCandidates;
    if (resolvedConnection === undefined) {
      return {
        ok: false,
        code: "invalid-connection",
        message: `Failed to resolve connection for GitHub installation '${installationId}'.`,
      };
    }

    return {
      ok: true,
      connectionId: resolvedConnection.id,
    };
  },
  async verify(input) {
    const webhookSecret = input.target.secrets.webhookSecret;
    if (webhookSecret === undefined || webhookSecret.length === 0) {
      return {
        ok: false,
        code: "invalid-body",
        message: "GitHub target secrets are missing webhook_secret.",
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
  parse(input) {
    const payload = parseJsonPayload(input.rawBody);
    const providerEventType = resolveProviderEventType(input.headers);
    const action = resolveAction(payload);
    const eventType = resolveEventType({
      providerEventType,
      action,
    });
    const deliveryId = resolveDeliveryId(input.headers);
    resolveInstallationId(payload);

    const sourceMetadata = resolveSourceMetadata({
      payload,
      providerEventType,
      action,
    });

    return {
      externalEventId: deliveryId,
      externalDeliveryId: deliveryId,
      providerEventType,
      eventType,
      payload,
      ...(sourceMetadata === null
        ? {}
        : {
            occurredAt: sourceMetadata.occurredAt,
            sourceOrderKey: sourceMetadata.sourceOrderKey,
          }),
    };
  },
};
