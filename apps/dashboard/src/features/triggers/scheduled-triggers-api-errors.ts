import {
  HttpApiError,
  type HttpApiErrorInput,
  normalizeHttpApiError,
  readApiErrorMessage,
  readHttpErrorCode,
} from "../api/http-api-error.js";

const ScheduledTriggerErrorMessages = {
  FORBIDDEN: "Select an active organization to manage scheduled triggers.",
  INVALID_PRIMARY_REPOSITORY: "The selected primary repository is invalid.",
  INVALID_SANDBOX_PROFILE_REFERENCE: "The selected sandbox profile is invalid.",
  INVALID_SANDBOX_PROFILE_VERSION_REFERENCE: "The selected sandbox profile version is invalid.",
  INVALID_SCHEDULE: "The schedule is invalid.",
  NOT_FOUND: "The scheduled trigger no longer exists.",
  UNAUTHORIZED: "Sign in again to manage scheduled triggers.",
};

type ScheduledTriggerErrorCode = keyof typeof ScheduledTriggerErrorMessages;

function isScheduledTriggerErrorCode(value: string): value is ScheduledTriggerErrorCode {
  return value in ScheduledTriggerErrorMessages;
}

function resolveScheduledTriggersMessage(input: { code: string | null; message: string }): string {
  if (input.code !== null && isScheduledTriggerErrorCode(input.code)) {
    return ScheduledTriggerErrorMessages[input.code];
  }

  return input.message;
}

export class ScheduledTriggersApiError extends HttpApiError {}

export function createScheduledTriggersApiError(
  input: HttpApiErrorInput,
): ScheduledTriggersApiError {
  return new ScheduledTriggersApiError({
    ...input,
    message: resolveScheduledTriggersMessage({
      code: input.code ?? null,
      message: input.message,
    }),
  });
}

export function toScheduledTriggersApiError(input: {
  operation: string;
  error: unknown;
  fallbackMessage: string;
}): ScheduledTriggersApiError {
  if (input.error instanceof ScheduledTriggersApiError) {
    return input.error;
  }

  return createScheduledTriggersApiError(
    normalizeHttpApiError({
      operation: input.operation,
      error: input.error,
      fallbackMessage: input.fallbackMessage,
    }),
  );
}

export function readScheduledTriggersErrorMessage(value: unknown): string | null {
  const code = readHttpErrorCode(value);
  if (code !== null && isScheduledTriggerErrorCode(code)) {
    return ScheduledTriggerErrorMessages[code];
  }

  return readApiErrorMessage(value);
}
