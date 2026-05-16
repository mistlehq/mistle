import {
  HttpApiError,
  type HttpApiErrorInput,
  normalizeHttpApiError,
  readApiErrorMessage,
  readHttpErrorCode,
} from "../api/http-api-error.js";

const WebhookTriggerErrorMessages = {
  CONNECTION_TARGET_NOT_WEBHOOK_CAPABLE:
    "The selected integration connection does not support webhook triggers.",
  FORBIDDEN: "Select an active organization to manage webhook triggers.",
  INVALID_CONNECTION_REFERENCE: "The selected integration connection is invalid.",
  INVALID_SANDBOX_PROFILE_REFERENCE: "The selected sandbox profile is invalid.",
  NOT_FOUND: "The webhook trigger no longer exists.",
  UNAUTHORIZED: "Sign in again to manage webhook triggers.",
} as const;

type WebhookTriggerErrorCode = keyof typeof WebhookTriggerErrorMessages;

function isWebhookTriggerErrorCode(value: string): value is WebhookTriggerErrorCode {
  return value in WebhookTriggerErrorMessages;
}

function resolveWebhookTriggersMessage(input: { code: string | null; message: string }): string {
  if (input.code !== null && isWebhookTriggerErrorCode(input.code)) {
    return WebhookTriggerErrorMessages[input.code];
  }

  return input.message;
}

export class WebhookTriggersApiError extends HttpApiError {}

export function createWebhookTriggersApiError(input: HttpApiErrorInput): WebhookTriggersApiError {
  return new WebhookTriggersApiError({
    ...input,
    message: resolveWebhookTriggersMessage({
      code: input.code ?? null,
      message: input.message,
    }),
  });
}

export function toWebhookTriggersApiError(input: {
  operation: string;
  error: unknown;
  fallbackMessage: string;
}): WebhookTriggersApiError {
  if (input.error instanceof WebhookTriggersApiError) {
    return input.error;
  }

  return createWebhookTriggersApiError(
    normalizeHttpApiError({
      operation: input.operation,
      error: input.error,
      fallbackMessage: input.fallbackMessage,
    }),
  );
}

export function readWebhookTriggersErrorMessage(value: unknown): string | null {
  const code = readHttpErrorCode(value);
  if (code !== null && isWebhookTriggerErrorCode(code)) {
    return WebhookTriggerErrorMessages[code];
  }

  return readApiErrorMessage(value);
}
