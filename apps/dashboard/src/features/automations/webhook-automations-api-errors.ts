import {
  HttpApiError,
  type HttpApiErrorInput,
  normalizeHttpApiError,
  readApiErrorMessage,
  readHttpErrorCode,
} from "../api/http-api-error.js";

const WebhookAutomationErrorMessages = {
  CONNECTION_TARGET_NOT_WEBHOOK_CAPABLE:
    "The selected integration connection does not support webhook automations.",
  FORBIDDEN: "Select an active organization to manage webhook automations.",
  INVALID_CONNECTION_REFERENCE: "The selected integration connection is invalid.",
  INVALID_LIST_WEBHOOK_AUTOMATIONS_INPUT: "The webhook automations request is invalid.",
  INVALID_PAGINATION_CURSOR: "The webhook automations page cursor is invalid.",
  INVALID_SANDBOX_PROFILE_REFERENCE: "The selected sandbox profile is invalid.",
  NOT_FOUND: "The webhook automation no longer exists.",
  UNAUTHORIZED: "Sign in again to manage webhook automations.",
} as const;

type WebhookAutomationErrorCode = keyof typeof WebhookAutomationErrorMessages;

function isWebhookAutomationErrorCode(value: string): value is WebhookAutomationErrorCode {
  return value in WebhookAutomationErrorMessages;
}

function resolveWebhookAutomationsMessage(input: { code: string | null; message: string }): string {
  if (input.code !== null && isWebhookAutomationErrorCode(input.code)) {
    return WebhookAutomationErrorMessages[input.code];
  }

  return input.message;
}

export class WebhookAutomationsApiError extends HttpApiError {}

export function createWebhookAutomationsApiError(
  input: HttpApiErrorInput,
): WebhookAutomationsApiError {
  return new WebhookAutomationsApiError({
    ...input,
    message: resolveWebhookAutomationsMessage({
      code: input.code ?? null,
      message: input.message,
    }),
  });
}

export function toWebhookAutomationsApiError(input: {
  operation: string;
  error: unknown;
  fallbackMessage: string;
}): WebhookAutomationsApiError {
  if (input.error instanceof WebhookAutomationsApiError) {
    return input.error;
  }

  return createWebhookAutomationsApiError(
    normalizeHttpApiError({
      operation: input.operation,
      error: input.error,
      fallbackMessage: input.fallbackMessage,
    }),
  );
}

export function readWebhookAutomationsErrorMessage(value: unknown): string | null {
  const code = readHttpErrorCode(value);
  if (code !== null && isWebhookAutomationErrorCode(code)) {
    return WebhookAutomationErrorMessages[code];
  }

  return readApiErrorMessage(value);
}
