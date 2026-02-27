import {
  HttpApiError,
  normalizeHttpApiError,
  readApiErrorMessage,
} from "../../api/http-api-error.js";

export function readErrorMessage(value: unknown): string | null {
  return readApiErrorMessage(value);
}

export class MembersApiError extends HttpApiError {}

export function toMembersApiError(operation: string, error: unknown): MembersApiError {
  if (error instanceof MembersApiError) {
    return error;
  }

  return new MembersApiError(
    normalizeHttpApiError({
      operation,
      error,
      fallbackMessage: `${operation} failed.`,
    }),
  );
}

export async function executeMembersOperation<T>(
  operation: string,
  execute: () => Promise<T>,
): Promise<T> {
  try {
    return await execute();
  } catch (error) {
    throw toMembersApiError(operation, error);
  }
}
