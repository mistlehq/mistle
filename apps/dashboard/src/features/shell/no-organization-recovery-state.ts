export type NoOrganizationRecoveryViewState = "loading" | "error" | "pending" | "empty";

export function resolveNoOrganizationRecoveryViewState(input: {
  isPending: boolean;
  isError: boolean;
  hasPendingInvitations: boolean;
}): NoOrganizationRecoveryViewState {
  if (input.isPending) {
    return "loading";
  }

  if (input.isError) {
    return "error";
  }

  if (input.hasPendingInvitations) {
    return "pending";
  }

  return "empty";
}
