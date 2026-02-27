import { readApiErrorMessage } from "./http-api-error.js";

export function resolveApiErrorMessage(input: { error: unknown; fallbackMessage: string }): string {
  const parsedMessage = readApiErrorMessage(input.error);
  if (parsedMessage !== null) {
    return parsedMessage;
  }

  if (input.error instanceof Error && input.error.message.trim().length > 0) {
    return input.error.message;
  }

  return input.fallbackMessage;
}
