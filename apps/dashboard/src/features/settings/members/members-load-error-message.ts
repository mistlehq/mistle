import type { MembersDirectoryFilter } from "./members-api-types.js";
import { toMembersErrorMessage } from "./members-status-messages.js";

export function toMembersLoadErrorMessage(input: {
  activeFilter: MembersDirectoryFilter;
  directoryError: unknown;
}): string {
  const fallbackMessage =
    input.activeFilter === "invitations"
      ? "Failed to load invitations."
      : "Failed to load members.";

  return toMembersErrorMessage(input.directoryError, fallbackMessage);
}
