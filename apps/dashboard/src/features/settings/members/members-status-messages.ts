import { MembersApiError } from "./members-api.js";

export function toMembersErrorMessage(error: unknown, fallbackMessage: string): string {
  if (error instanceof MembersApiError) {
    return error.message;
  }

  if (error instanceof Error && error.message.trim().length > 0) {
    return error.message;
  }

  return fallbackMessage;
}
