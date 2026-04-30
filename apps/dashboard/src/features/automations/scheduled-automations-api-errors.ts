import {
  HttpApiError,
  type HttpApiErrorInput,
  normalizeHttpApiError,
  readApiErrorMessage,
  readHttpErrorCode,
} from "../api/http-api-error.js";

const ScheduledAutomationErrorMessages = {
  FORBIDDEN: "Select an active organization to manage scheduled automations.",
  INVALID_PRIMARY_REPOSITORY: "The selected primary repository is invalid.",
  INVALID_SANDBOX_PROFILE_REFERENCE: "The selected sandbox profile is invalid.",
  INVALID_SANDBOX_PROFILE_VERSION_REFERENCE: "The selected sandbox profile version is invalid.",
  INVALID_SCHEDULE: "The schedule is invalid.",
  NOT_FOUND: "The scheduled automation no longer exists.",
  UNAUTHORIZED: "Sign in again to manage scheduled automations.",
};

type ScheduledAutomationErrorCode = keyof typeof ScheduledAutomationErrorMessages;

function isScheduledAutomationErrorCode(value: string): value is ScheduledAutomationErrorCode {
  return value in ScheduledAutomationErrorMessages;
}

function resolveScheduledAutomationsMessage(input: {
  code: string | null;
  message: string;
}): string {
  if (input.code !== null && isScheduledAutomationErrorCode(input.code)) {
    return ScheduledAutomationErrorMessages[input.code];
  }

  return input.message;
}

export class ScheduledAutomationsApiError extends HttpApiError {}

export function createScheduledAutomationsApiError(
  input: HttpApiErrorInput,
): ScheduledAutomationsApiError {
  return new ScheduledAutomationsApiError({
    ...input,
    message: resolveScheduledAutomationsMessage({
      code: input.code ?? null,
      message: input.message,
    }),
  });
}

export function toScheduledAutomationsApiError(input: {
  operation: string;
  error: unknown;
  fallbackMessage: string;
}): ScheduledAutomationsApiError {
  if (input.error instanceof ScheduledAutomationsApiError) {
    return input.error;
  }

  return createScheduledAutomationsApiError(
    normalizeHttpApiError({
      operation: input.operation,
      error: input.error,
      fallbackMessage: input.fallbackMessage,
    }),
  );
}

export function readScheduledAutomationsErrorMessage(value: unknown): string | null {
  const code = readHttpErrorCode(value);
  if (code !== null && isScheduledAutomationErrorCode(code)) {
    return ScheduledAutomationErrorMessages[code];
  }

  return readApiErrorMessage(value);
}
