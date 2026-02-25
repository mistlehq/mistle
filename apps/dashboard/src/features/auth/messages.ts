import type { AuthClientError } from "./types.js";

export function resolveErrorMessage(error: AuthClientError, fallback: string): string {
  const message = error?.message;
  if (message && message.trim().length > 0) {
    return message;
  }
  return fallback;
}
