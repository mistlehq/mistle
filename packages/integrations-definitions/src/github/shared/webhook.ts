import type {
  IntegrationWebhookHandler,
  IntegrationWebhookResolveConnectionResult,
  IntegrationWebhookVerifyResult,
} from "@mistle/integrations-core";
import { verify } from "@octokit/webhooks-methods";
import { z } from "zod";

import { GitHubFamilyId } from "./constants.js";
import type { GitHubTargetConfig } from "./target-config-schema.js";
import type { GitHubTargetSecrets } from "./target-secret-schema.js";

const GitHubWebhookEventHeaderName = "x-github-event";
const GitHubWebhookDeliveryHeaderName = "x-github-delivery";
const GitHubWebhookSignatureHeaderName = "x-hub-signature-256";
const GitHubWebhookPayloadSchema = z
  .object({
    installation: z
      .object({
        id: z.union([z.number().int(), z.string().trim().min(1)]),
      })
      .catchall(z.unknown())
      .optional(),
    action: z.string().trim().min(1).optional(),
    comment: z
      .object({
        id: z.union([z.number().int(), z.string().trim().min(1)]).optional(),
        created_at: z.string().trim().min(1).optional(),
      })
      .catchall(z.unknown())
      .optional(),
  })
  .catchall(z.unknown());

type GitHubWebhookPayload = z.infer<typeof GitHubWebhookPayloadSchema>;

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

function parseJsonPayload(input: Uint8Array): GitHubWebhookPayload {
  const decodedBody = decodeRawBody(input);
  let parsedPayload: unknown;

  try {
    parsedPayload = JSON.parse(decodedBody);
  } catch {
    throw new Error("GitHub webhook payload must be valid JSON.");
  }

  const payloadResult = GitHubWebhookPayloadSchema.safeParse(parsedPayload);
  if (!payloadResult.success) {
    throw new Error("GitHub webhook payload must be a JSON object.");
  }

  return payloadResult.data;
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

function resolveInstallationId(input: GitHubWebhookPayload): string {
  const installation = input.installation;
  if (installation === undefined) {
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

function resolveAction(input: GitHubWebhookPayload): string {
  const action = input.action;

  if (action !== undefined) {
    return action;
  }

  return "unknown";
}

function resolveNumericIdentifier(
  input: GitHubWebhookPayload,
  key: keyof GitHubWebhookPayload,
): string | null {
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

function resolveTimestampField(
  input: GitHubWebhookPayload,
  key: keyof GitHubWebhookPayload,
): string | null {
  const value = input[key];
  if (typeof value !== "string" || value.trim().length === 0) {
    return null;
  }

  const normalizedValue = value.trim();
  return Number.isNaN(Date.parse(normalizedValue)) ? null : normalizedValue;
}

function resolveCommentOrdering(input: GitHubWebhookPayload): {
  occurredAt?: string;
  sourceOrderKey?: string;
} {
  const comment = input.comment;
  if (comment === undefined) {
    return {};
  }

  const occurredAt = resolveTimestampField(comment, "created_at");
  const commentId = resolveNumericIdentifier(comment, "id");
  if (occurredAt === null || commentId === null) {
    return {};
  }

  return {
    occurredAt,
    sourceOrderKey: `${occurredAt}#${commentId}`,
  };
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
    const deliveryId = resolveDeliveryId(input.headers);
    resolveInstallationId(payload);
    const ordering = resolveCommentOrdering(payload);

    return {
      externalEventId: deliveryId,
      externalDeliveryId: deliveryId,
      providerEventType,
      eventType: resolveEventType({
        providerEventType,
        action,
      }),
      payload,
      ...(ordering.occurredAt === undefined ? {} : { occurredAt: ordering.occurredAt }),
      ...(ordering.sourceOrderKey === undefined ? {} : { sourceOrderKey: ordering.sourceOrderKey }),
    };
  },
};
