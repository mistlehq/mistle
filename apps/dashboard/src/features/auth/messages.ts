import type { AuthClientError } from "./types.js";

export function resolveErrorMessage(error: AuthClientError, fallback: string): string {
  const message = error?.message;
  if (message && message.trim().length > 0) {
    return message;
  }
  return fallback;
}

export function resolveOAuthCallbackError(searchParams: URLSearchParams): string | null {
  const error = searchParams.get("error");
  const errorDescription = searchParams.get("error_description");

  if (error === null || error.length === 0) {
    return null;
  }

  if (error === "access_denied") {
    return "Google sign-in was cancelled.";
  }

  if (errorDescription !== null && errorDescription.trim().length > 0) {
    return errorDescription;
  }

  return "Unable to continue with Google.";
}
