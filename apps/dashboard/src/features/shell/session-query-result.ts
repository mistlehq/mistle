import { resolveErrorMessage } from "../auth/messages.js";
import type { SessionData } from "../auth/types.js";

function readAuthClientError(error: unknown): { message?: string; status?: number } | null {
  if (typeof error !== "object" || error === null) {
    return null;
  }

  const messageValue = Object.getOwnPropertyDescriptor(error, "message")?.value;
  const statusValue = Object.getOwnPropertyDescriptor(error, "status")?.value;
  const parsedMessage = typeof messageValue === "string" ? messageValue : undefined;
  const parsedStatus = typeof statusValue === "number" ? statusValue : undefined;

  if (parsedMessage === undefined && parsedStatus === undefined) {
    return null;
  }

  const authClientError: { message?: string; status?: number } = {};
  if (parsedMessage !== undefined) {
    authClientError.message = parsedMessage;
  }
  if (parsedStatus !== undefined) {
    authClientError.status = parsedStatus;
  }

  return authClientError;
}

export function resolveSessionFromAuthPayload(input: {
  data: SessionData;
  error: unknown;
}): SessionData {
  if (input.error === null) {
    return input.data;
  }

  const authClientError = readAuthClientError(input.error);
  const status = authClientError?.status ?? null;

  if (status === 401) {
    return null;
  }

  throw new Error(resolveErrorMessage(authClientError, "Unable to load session."));
}
