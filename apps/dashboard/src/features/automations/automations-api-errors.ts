import {
  HttpApiError,
  type HttpApiErrorInput,
  normalizeHttpApiError,
} from "../api/http-api-error.js";

const AutomationsErrorMessages = {
  FORBIDDEN: "Select an active organization to manage triggers.",
  INVALID_LIST_AUTOMATIONS_INPUT: "The triggers request is invalid.",
  INVALID_PAGINATION_CURSOR: "The triggers page cursor is invalid.",
  UNAUTHORIZED: "Sign in again to manage triggers.",
  VALIDATION_ERROR: "The triggers request is invalid.",
} as const;

type AutomationsErrorCode = keyof typeof AutomationsErrorMessages;

function isAutomationsErrorCode(value: string): value is AutomationsErrorCode {
  return value in AutomationsErrorMessages;
}

function resolveAutomationsMessage(input: { code: string | null; message: string }): string {
  if (input.code !== null && isAutomationsErrorCode(input.code)) {
    return AutomationsErrorMessages[input.code];
  }

  return input.message;
}

export class AutomationsApiError extends HttpApiError {}

export function createAutomationsApiError(input: HttpApiErrorInput): AutomationsApiError {
  return new AutomationsApiError({
    ...input,
    message: resolveAutomationsMessage({
      code: input.code ?? null,
      message: input.message,
    }),
  });
}

export function toAutomationsApiError(input: {
  operation: string;
  error: unknown;
  fallbackMessage: string;
}): AutomationsApiError {
  if (input.error instanceof AutomationsApiError) {
    return input.error;
  }

  return createAutomationsApiError(
    normalizeHttpApiError({
      operation: input.operation,
      error: input.error,
      fallbackMessage: input.fallbackMessage,
    }),
  );
}
