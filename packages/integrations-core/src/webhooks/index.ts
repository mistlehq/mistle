import {
  IntegrationWebhookError,
  WebhookErrorCodes,
  type WebhookErrorCode,
} from "../errors/index.js";
import type {
  IntegrationConnection,
  IntegrationDefinition,
  IntegrationTarget,
  IntegrationWebhookEvent,
  IntegrationWebhookEventDefinition,
  IntegrationWebhookHandler,
  IntegrationWebhookHeaders,
  IntegrationWebhookRequestResolution,
  IntegrationWebhookResolveConnectionFailureCode,
  IntegrationWebhookResolvedRequest,
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
> = Pick<IntegrationDefinition, "familyId" | "variantId" | "supportedWebhookEvents"> & {
  webhookHandler?: IntegrationWebhookHandler<TTargetConfig, TTargetSecrets, TConnectionSecrets>;
};

type WebhookSourceOrderDefinition = Pick<IntegrationDefinition, "familyId" | "variantId"> & {
  supportedWebhookEvents?: ReadonlyArray<IntegrationWebhookEventDefinition> | undefined;
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

export function createIntegrationWebhookSourceOrderKey(input: {
  occurredAt: string;
  orderingIdentifier: string;
}): string {
  const occurredAt = input.occurredAt.trim();
  const orderingIdentifier = input.orderingIdentifier.trim();
  if (occurredAt.length === 0) {
    throw createWebhookError(
      WebhookErrorCodes.WEBHOOK_SOURCE_ORDER_KEY_MISSING,
      "Webhook source order key requires a non-empty occurrence timestamp.",
    );
  }

  if (orderingIdentifier.length === 0) {
    throw createWebhookError(
      WebhookErrorCodes.WEBHOOK_SOURCE_ORDER_KEY_MISSING,
      "Webhook source order key requires a non-empty ordering identifier.",
    );
  }

  return `${occurredAt}#${orderingIdentifier}`;
}

function assertSupportedWebhookEventHasSourceOrderKey(input: {
  definition: WebhookSourceOrderDefinition;
  event: IntegrationWebhookEvent;
}): void {
  const supportedWebhookEvents = input.definition.supportedWebhookEvents;
  if (
    supportedWebhookEvents === undefined ||
    !supportedWebhookEvents.some(
      (supportedEvent) => supportedEvent.eventType === input.event.eventType,
    )
  ) {
    return;
  }

  if (input.event.sourceOrderKey !== undefined && input.event.sourceOrderKey.trim().length > 0) {
    return;
  }

  throw createWebhookError(
    WebhookErrorCodes.WEBHOOK_SOURCE_ORDER_KEY_MISSING,
    `Webhook event '${input.event.eventType}' from integration '${input.definition.familyId}/${input.definition.variantId}' is advertised for triggers but is missing sourceOrderKey.`,
  );
}

function getWebhookConnectionResolutionErrorCode(
  input: IntegrationWebhookResolveConnectionFailureCode,
): WebhookErrorCode {
  if (input === "connection-not-found") {
    return WebhookErrorCodes.WEBHOOK_CONNECTION_NOT_FOUND;
  }

  if (input === "connection-ambiguous") {
    return WebhookErrorCodes.WEBHOOK_CONNECTION_AMBIGUOUS;
  }

  return WebhookErrorCodes.WEBHOOK_CONNECTION_RESOLUTION_FAILED;
}

export type VerifyAndResolveWebhookRequestInput<
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
  connections: ReadonlyArray<IntegrationConnection>;
  resolveConnectionSecrets(input: {
    connectionId: string;
  }): TConnectionSecrets | Promise<TConnectionSecrets>;
  webhookSourceSecrets?: Record<string, string>;
  webhookRequest?: IntegrationWebhookRequestResolution;
  headers: IntegrationWebhookHeaders;
  rawBody: Uint8Array;
};

export async function verifyAndResolveWebhookRequestOrThrow<
  TTargetConfig = Record<string, unknown>,
  TTargetSecrets = Record<string, string>,
  TConnectionSecrets = Record<string, string>,
>(
  input: VerifyAndResolveWebhookRequestInput<TTargetConfig, TTargetSecrets, TConnectionSecrets>,
): Promise<IntegrationWebhookResolvedRequest> {
  const webhookHandler = getWebhookHandlerOrThrow(input.definition);

  const webhookRequest =
    input.webhookRequest ??
    (await webhookHandler.resolveWebhookRequest({
      targetKey: input.targetKey,
      target: input.target,
      headers: input.headers,
      rawBody: input.rawBody,
    }));

  if (webhookRequest.kind === "response" && webhookRequest.verification === "skip") {
    return {
      kind: "response",
      response: webhookRequest.response,
    };
  }

  const webhookEvent = webhookRequest.event;

  const resolvedConnection = await webhookHandler.resolveConnection({
    targetKey: input.targetKey,
    target: input.target,
    event: webhookEvent,
    candidates: input.connections,
  });
  if (!resolvedConnection.ok) {
    throw createWebhookError(
      getWebhookConnectionResolutionErrorCode(resolvedConnection.code),
      [
        "Webhook connection resolution failed",
        `(${resolvedConnection.code}):`,
        resolvedConnection.message,
      ].join(" "),
    );
  }

  const connection = input.connections.find(
    (candidateConnection) => candidateConnection.id === resolvedConnection.connectionId,
  );
  if (connection === undefined) {
    throw createWebhookError(
      WebhookErrorCodes.WEBHOOK_CONNECTION_RESOLUTION_FAILED,
      `Webhook connection resolution returned unknown connectionId '${resolvedConnection.connectionId}'.`,
    );
  }

  const connectionSecrets = await input.resolveConnectionSecrets({
    connectionId: connection.id,
  });

  const verifyResult = await webhookHandler.verify({
    targetKey: input.targetKey,
    target: input.target,
    event: webhookEvent,
    connection,
    connectionSecrets,
    webhookSourceSecrets: input.webhookSourceSecrets ?? {},
    headers: input.headers,
    rawBody: input.rawBody,
  });

  if (!verifyResult.ok) {
    throw createWebhookError(
      WebhookErrorCodes.WEBHOOK_VERIFY_FAILED,
      `Webhook verification failed (${verifyResult.code}): ${verifyResult.message}`,
    );
  }

  const enrichedWebhookEvent =
    webhookHandler.enrichEvent === undefined
      ? webhookEvent
      : await webhookHandler.enrichEvent({
          targetKey: input.targetKey,
          target: input.target,
          event: webhookEvent,
          connection,
          connectionSecrets,
          webhookSourceSecrets: input.webhookSourceSecrets ?? {},
          headers: input.headers,
          rawBody: input.rawBody,
        });

  assertSupportedWebhookEventHasSourceOrderKey({
    definition: input.definition,
    event: enrichedWebhookEvent,
  });

  if (webhookRequest.kind === "response") {
    return {
      kind: "response",
      response: webhookRequest.response,
    };
  }

  return {
    kind: "event",
    event: enrichedWebhookEvent,
    connectionId: connection.id,
  };
}
