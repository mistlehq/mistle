import {
  HttpApiError,
  type HttpApiErrorInput,
  normalizeHttpApiError,
} from "../api/http-api-error.js";

const TriggersErrorMessages = {
  FORBIDDEN: "Select an active organization to manage triggers.",
  INVALID_LIST_AUTOMATIONS_INPUT: "The triggers request is invalid.",
  INVALID_PAGINATION_CURSOR: "The triggers page cursor is invalid.",
  UNAUTHORIZED: "Sign in again to manage triggers.",
  VALIDATION_ERROR: "The triggers request is invalid.",
} as const;

type TriggersErrorCode = keyof typeof TriggersErrorMessages;

function isTriggersErrorCode(value: string): value is TriggersErrorCode {
  return value in TriggersErrorMessages;
}

function resolveTriggersMessage(input: { code: string | null; message: string }): string {
  if (input.code !== null && isTriggersErrorCode(input.code)) {
    return TriggersErrorMessages[input.code];
  }

  return input.message;
}

export class TriggersApiError extends HttpApiError {}

export function createTriggersApiError(input: HttpApiErrorInput): TriggersApiError {
  return new TriggersApiError({
    ...input,
    message: resolveTriggersMessage({
      code: input.code ?? null,
      message: input.message,
    }),
  });
}

export function toTriggersApiError(input: {
  operation: string;
  error: unknown;
  fallbackMessage: string;
}): TriggersApiError {
  if (input.error instanceof TriggersApiError) {
    return input.error;
  }

  return createTriggersApiError(
    normalizeHttpApiError({
      operation: input.operation,
      error: input.error,
      fallbackMessage: input.fallbackMessage,
    }),
  );
}
