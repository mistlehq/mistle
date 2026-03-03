import {
  IntegrationWebhookError,
  WebhookErrorCodes,
  type WebhookErrorCode,
} from "../errors/index.js";
import type {
  IntegrationDefinition,
  IntegrationTarget,
  IntegrationWebhookConnectionRef,
  IntegrationWebhookEvent,
  IntegrationWebhookHandler,
  IntegrationWebhookHeaders,
} from "../types/index.js";

export type NormalizeWebhookHeadersInput = Readonly<Record<string, string | string[] | undefined>>;

function normalizeHeaderName(input: string): string {
  return input.trim().toLowerCase();
}

function normalizeHeaderValue(input: string | string[]): string {
  if (typeof input === "string") {
    return input.trim();
  }

  return input.map((value) => value.trim()).join(",");
}

function createWebhookError(code: WebhookErrorCode, message: string): IntegrationWebhookError {
  return new IntegrationWebhookError(code, message);
}

export function normalizeWebhookHeaders(
  input: NormalizeWebhookHeadersInput,
): IntegrationWebhookHeaders {
  const normalizedHeaders: Record<string, string> = {};

  for (const [headerName, headerValue] of Object.entries(input)) {
    if (headerValue === undefined) {
      continue;
    }

    const normalizedName = normalizeHeaderName(headerName);
    if (normalizedName.length === 0) {
      continue;
    }

    const normalizedValue = normalizeHeaderValue(headerValue);
    const existingValue = normalizedHeaders[normalizedName];

    if (existingValue === undefined) {
      normalizedHeaders[normalizedName] = normalizedValue;
      continue;
    }

    normalizedHeaders[normalizedName] = `${existingValue},${normalizedValue}`;
  }

  return normalizedHeaders;
}

export type WebhookDefinition<
  TTargetConfig = Record<string, unknown>,
  TTargetSecrets = Record<string, string>,
  TConnectionSecrets = Record<string, string>,
> = Pick<IntegrationDefinition, "familyId" | "variantId"> & {
  webhookHandler?: IntegrationWebhookHandler<TTargetConfig, TTargetSecrets, TConnectionSecrets>;
};

export function getWebhookHandlerOrThrow<
  TTargetConfig = Record<string, unknown>,
  TTargetSecrets = Record<string, string>,
  TConnectionSecrets = Record<string, string>,
>(
  input: WebhookDefinition<TTargetConfig, TTargetSecrets, TConnectionSecrets>,
): IntegrationWebhookHandler<TTargetConfig, TTargetSecrets, TConnectionSecrets> {
  const webhookHandler = input.webhookHandler;
  if (webhookHandler !== undefined) {
    return webhookHandler;
  }

  throw createWebhookError(
    WebhookErrorCodes.WEBHOOK_HANDLER_NOT_CONFIGURED,
    `Integration '${input.familyId}/${input.variantId}' does not define a webhook handler.`,
  );
}

export function assertSupportedWebhookEventTypeOrThrow(input: {
  eventType: string;
  supportedEventTypes?: ReadonlyArray<string>;
}): void {
  if (input.supportedEventTypes === undefined) {
    return;
  }

  if (input.supportedEventTypes.includes(input.eventType)) {
    return;
  }

  throw createWebhookError(
    WebhookErrorCodes.WEBHOOK_UNSUPPORTED_EVENT_TYPE,
    `Unsupported webhook event type '${input.eventType}'.`,
  );
}

export function assertWebhookConnectionRefOrThrow(input: {
  routeTargetKey: string;
  connectionRef: IntegrationWebhookConnectionRef;
}): void {
  if (input.connectionRef.targetKey === input.routeTargetKey) {
    return;
  }

  throw createWebhookError(
    WebhookErrorCodes.WEBHOOK_TARGET_KEY_MISMATCH,
    `Webhook connection targetKey '${input.connectionRef.targetKey}' does not match route targetKey '${input.routeTargetKey}'.`,
  );
}

export type VerifyAndParseWebhookInput<
  TTargetConfig = Record<string, unknown>,
  TTargetSecrets = Record<string, string>,
  TConnectionSecrets = Record<string, string>,
> = {
  definition: WebhookDefinition<TTargetConfig, TTargetSecrets, TConnectionSecrets>;
  targetKey: string;
  target: Omit<IntegrationTarget, "config" | "secrets"> & {
    config: TTargetConfig;
    secrets: TTargetSecrets;
  };
  resolveConnectionSecrets(input: {
    connectionRef: IntegrationWebhookConnectionRef;
  }): TConnectionSecrets | Promise<TConnectionSecrets>;
  headers: IntegrationWebhookHeaders;
  rawBody: Uint8Array;
};

export async function verifyAndParseWebhookOrThrow<
  TTargetConfig = Record<string, unknown>,
  TTargetSecrets = Record<string, string>,
  TConnectionSecrets = Record<string, string>,
>(
  input: VerifyAndParseWebhookInput<TTargetConfig, TTargetSecrets, TConnectionSecrets>,
): Promise<IntegrationWebhookEvent> {
  const webhookHandler = getWebhookHandlerOrThrow(input.definition);

  const webhookEvent = await webhookHandler.parse({
    targetKey: input.targetKey,
    target: input.target,
    headers: input.headers,
    rawBody: input.rawBody,
  });

  assertWebhookConnectionRefOrThrow({
    routeTargetKey: input.targetKey,
    connectionRef: webhookEvent.connectionRef,
  });

  const connectionSecrets = await input.resolveConnectionSecrets({
    connectionRef: webhookEvent.connectionRef,
  });

  const verifyResult = await webhookHandler.verify({
    targetKey: input.targetKey,
    target: input.target,
    connectionRef: webhookEvent.connectionRef,
    connectionSecrets,
    headers: input.headers,
    rawBody: input.rawBody,
  });

  if (!verifyResult.ok) {
    throw createWebhookError(
      WebhookErrorCodes.WEBHOOK_VERIFY_FAILED,
      `Webhook verification failed (${verifyResult.code}): ${verifyResult.message}`,
    );
  }

  if (webhookHandler.supportedEventTypes !== undefined) {
    assertSupportedWebhookEventTypeOrThrow({
      eventType: webhookEvent.eventType,
      supportedEventTypes: webhookHandler.supportedEventTypes,
    });
  }

  return webhookEvent;
}
