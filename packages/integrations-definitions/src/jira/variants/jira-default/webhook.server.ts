import { createHmac, timingSafeEqual } from "node:crypto";

import {
  createIntegrationWebhookSourceOrderKey,
  type IntegrationConnection,
  type IntegrationWebhookHandler,
  type IntegrationWebhookResolveConnectionResult,
  type IntegrationWebhookVerifyResult,
} from "@mistle/integrations-core";

import {
  JiraConnectionMethodIds,
  JiraPersonalApiTokenConnectionConfigSchema,
  normalizeJiraBaseUrl,
} from "./auth.js";
import type { JiraTargetConfig } from "./target-config-schema.js";
import type { JiraTargetSecrets } from "./target-secret-schema.js";

const JiraWebhookIdentifierHeaderName = "x-atlassian-webhook-identifier";
const JiraWebhookSignatureHeaderName = "x-hub-signature";

function parseJsonPayload(input: Uint8Array): Record<string, unknown> {
  const decodedBody = new TextDecoder().decode(input);
  let parsedPayload: unknown;

  try {
    parsedPayload = JSON.parse(decodedBody);
  } catch {
    throw new Error("Jira webhook payload must be valid JSON.");
  }

  if (typeof parsedPayload !== "object" || parsedPayload === null) {
    throw new Error("Jira webhook payload must be a JSON object.");
  }

  return Object.fromEntries(Object.entries(parsedPayload));
}

function resolveWebhookIdentifier(input: Readonly<Record<string, string>>): string {
  const identifier = input[JiraWebhookIdentifierHeaderName];

  if (identifier === undefined || identifier.trim().length === 0) {
    throw new Error("Jira webhook is missing x-atlassian-webhook-identifier header.");
  }

  return identifier.trim();
}

function resolveProviderEventType(input: Record<string, unknown>): string {
  const webhookEvent = input.webhookEvent;
  if (typeof webhookEvent !== "string" || webhookEvent.trim().length === 0) {
    throw new Error("Jira webhook payload is missing webhookEvent.");
  }

  return webhookEvent.trim();
}

function resolveIssuePayload(input: Record<string, unknown>): Record<string, unknown> {
  const issue = input.issue;
  if (typeof issue !== "object" || issue === null) {
    throw new Error("Jira webhook payload is missing issue.");
  }

  return Object.fromEntries(Object.entries(issue));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function normalizeJiraPlainTextWhitespace(value: string): string {
  return value.replaceAll(/\s+/g, " ").trim();
}

function isJiraBlockNodeType(value: unknown): boolean {
  return (
    value === "doc" ||
    value === "paragraph" ||
    value === "blockquote" ||
    value === "bulletList" ||
    value === "orderedList" ||
    value === "listItem" ||
    value === "table" ||
    value === "tableRow" ||
    value === "tableCell" ||
    value === "tableHeader" ||
    value === "panel"
  );
}

function extractJiraDocumentText(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }

  if (Array.isArray(value)) {
    return value.map((item) => extractJiraDocumentText(item)).join("");
  }

  if (!isRecord(value)) {
    return "";
  }

  const nodeType = value["type"];
  const text = value["text"];
  const content = value["content"];
  const attrs = value["attrs"];

  if (nodeType === "hardBreak") {
    return "\n";
  }

  const attrsText = isRecord(attrs) && typeof attrs["text"] === "string" ? attrs["text"] : "";
  const contentText = Array.isArray(content)
    ? content
        .map((item) => extractJiraDocumentText(item))
        .join(isJiraBlockNodeType(nodeType) && nodeType !== "paragraph" ? "\n" : "")
    : "";

  return `${typeof text === "string" ? text : attrsText}${contentText}`;
}

function normalizeJiraCommentPayload(input: Record<string, unknown>): Record<string, unknown> {
  const comment = input.comment;
  if (!isRecord(comment)) {
    return input;
  }

  return {
    ...input,
    comment: {
      ...comment,
      mistlePlainText: normalizeJiraPlainTextWhitespace(extractJiraDocumentText(comment["body"])),
    },
  };
}

function resolveSiteUrlFromPayload(input: Record<string, unknown>): string | null {
  const issue = resolveIssuePayload(input);
  const issueSelf = issue.self;
  if (typeof issueSelf !== "string" || issueSelf.trim().length === 0) {
    return null;
  }

  try {
    return normalizeJiraBaseUrl(new URL(issueSelf).origin);
  } catch {
    return null;
  }
}

function resolveWebhookTimestamp(input: Record<string, unknown>): string | undefined {
  const timestamp = input.timestamp;
  if (typeof timestamp !== "number" || !Number.isFinite(timestamp)) {
    return undefined;
  }

  return new Date(timestamp).toISOString();
}

function resolveOrderingIdentifier(input: {
  payload: Record<string, unknown>;
  providerEventType: string;
}): string | undefined {
  const providerSpecificObject = input.providerEventType.startsWith("comment_")
    ? input.payload.comment
    : input.payload.changelog;
  if (typeof providerSpecificObject !== "object" || providerSpecificObject === null) {
    return undefined;
  }

  const providerSpecificRecord = Object.fromEntries(Object.entries(providerSpecificObject));
  const identifier = providerSpecificRecord.id;
  if (typeof identifier === "number" && Number.isInteger(identifier)) {
    return identifier.toString().padStart(20, "0");
  }

  if (typeof identifier === "string" && identifier.trim().length > 0) {
    return identifier.trim();
  }

  return undefined;
}

function resolveSourceOrderKey(input: {
  payload: Record<string, unknown>;
  providerEventType: string;
}): string | undefined {
  const occurredAt = resolveWebhookTimestamp(input.payload);
  const orderingIdentifier = resolveOrderingIdentifier(input);

  if (occurredAt === undefined || orderingIdentifier === undefined) {
    return undefined;
  }

  return createIntegrationWebhookSourceOrderKey({
    occurredAt,
    orderingIdentifier,
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
      message: "No active Jira connection matched the webhook source.",
    };
  }

  if (candidates.length > 1) {
    return {
      ok: false,
      code: "connection-ambiguous",
      message: "Multiple active Jira connections matched the webhook source.",
    };
  }

  return {
    ok: true,
    connectionId: candidate.id,
  };
}

function resolvePayloadSiteUrlConnection(input: {
  payload: Record<string, unknown>;
  candidates: ReadonlyArray<IntegrationConnection>;
}): IntegrationWebhookResolveConnectionResult {
  const payloadSiteUrl = resolveSiteUrlFromPayload(input.payload);
  if (payloadSiteUrl === null) {
    return resolvePathRoutedConnection(input.candidates);
  }

  const matchingCandidates = input.candidates.filter((candidateConnection) => {
    const parsedConfig = candidateConnection.config;
    if (typeof parsedConfig !== "object" || parsedConfig === null) {
      return false;
    }

    const normalizedConfig = Object.fromEntries(Object.entries(parsedConfig));
    if (normalizedConfig.connection_method !== JiraConnectionMethodIds.PERSONAL_API_TOKEN) {
      return false;
    }

    const siteUrl = normalizedConfig.site_url;
    return typeof siteUrl === "string" && normalizeJiraBaseUrl(siteUrl) === payloadSiteUrl;
  });

  if (matchingCandidates.length === 0) {
    return {
      ok: false,
      code: "connection-not-found",
      message: `No active Jira connection matched site '${payloadSiteUrl}'.`,
    };
  }

  if (matchingCandidates.length > 1) {
    return {
      ok: false,
      code: "connection-ambiguous",
      message: `Multiple active Jira connections matched site '${payloadSiteUrl}'.`,
    };
  }

  const matchingCandidate = matchingCandidates[0];
  if (matchingCandidate === undefined) {
    throw new Error("Expected matching Jira connection to exist.");
  }

  return {
    ok: true,
    connectionId: matchingCandidate.id,
  };
}

function resolveWebhookSignatureHeader(input: Readonly<Record<string, string>>): string {
  const signature = input[JiraWebhookSignatureHeaderName];

  if (signature === undefined || signature.trim().length === 0) {
    throw new Error("Jira webhook is missing x-hub-signature header.");
  }

  return signature.trim();
}

export function buildJiraWebhookSignature(input: {
  webhookSecret: string;
  method: string;
  rawBody: Uint8Array;
}): string {
  const signature = createHmac(input.method, input.webhookSecret)
    .update(input.rawBody)
    .digest("hex");
  return `${input.method}=${signature}`;
}

export function verifyJiraWebhookSignature(input: {
  webhookSecret: string;
  rawBody: Uint8Array;
  signature: string;
}): IntegrationWebhookVerifyResult {
  const [method, providedDigest] = input.signature.split("=", 2);
  if (
    method === undefined ||
    providedDigest === undefined ||
    method.trim().length === 0 ||
    providedDigest.trim().length === 0
  ) {
    return {
      ok: false,
      code: "invalid-signature",
      message: "Jira webhook signature header is malformed.",
    };
  }

  let expectedSignature: string;
  try {
    expectedSignature = buildJiraWebhookSignature({
      webhookSecret: input.webhookSecret,
      method,
      rawBody: input.rawBody,
    });
  } catch {
    return {
      ok: false,
      code: "invalid-signature",
      message: `Jira webhook signature method '${method}' is not supported.`,
    };
  }

  const expectedBytes = Buffer.from(expectedSignature, "utf8");
  const actualBytes = Buffer.from(input.signature, "utf8");
  if (expectedBytes.length === actualBytes.length && timingSafeEqual(expectedBytes, actualBytes)) {
    return {
      ok: true,
    };
  }

  return {
    ok: false,
    code: "invalid-signature",
    message: "Jira webhook signature verification failed.",
  };
}

export const JiraWebhookHandler: IntegrationWebhookHandler<
  JiraTargetConfig,
  JiraTargetSecrets,
  Record<string, string>
> = {
  resolveWebhookRequest(input) {
    const payload = normalizeJiraCommentPayload(parseJsonPayload(input.rawBody));
    const providerEventType = resolveProviderEventType(payload);
    const webhookIdentifier = resolveWebhookIdentifier(input.headers);
    const occurredAt = resolveWebhookTimestamp(payload);
    const sourceOrderKey = resolveSourceOrderKey({
      payload,
      providerEventType,
    });
    resolveIssuePayload(payload);

    return {
      kind: "event",
      event: {
        externalEventId: webhookIdentifier,
        externalDeliveryId: webhookIdentifier,
        providerEventType,
        eventType: providerEventType,
        payload,
        ...(occurredAt === undefined ? {} : { occurredAt }),
        ...(sourceOrderKey === undefined ? {} : { sourceOrderKey }),
      },
    };
  },
  resolveConnection(input): IntegrationWebhookResolveConnectionResult {
    if (input.candidates.length <= 1) {
      return resolvePathRoutedConnection(input.candidates);
    }

    return resolvePayloadSiteUrlConnection({
      payload: input.event.payload,
      candidates: input.candidates,
    });
  },
  verify(input): IntegrationWebhookVerifyResult {
    const parsedConnectionConfig = JiraPersonalApiTokenConnectionConfigSchema.safeParse(
      input.connection.config,
    );
    if (!parsedConnectionConfig.success) {
      return {
        ok: false,
        code: "invalid-body",
        message: "Jira webhook verification only supports personal API token connections.",
      };
    }

    const webhookSecret = input.webhookSourceSecrets.webhookSecret;
    if (webhookSecret === undefined || webhookSecret.length === 0) {
      return {
        ok: false,
        code: "invalid-body",
        message: "Jira webhook secret is missing for this source.",
      };
    }

    return verifyJiraWebhookSignature({
      webhookSecret,
      rawBody: input.rawBody,
      signature: resolveWebhookSignatureHeader(input.headers),
    });
  },
};
