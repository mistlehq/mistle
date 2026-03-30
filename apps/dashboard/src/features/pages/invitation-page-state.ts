import type { InvitationDetails } from "./invitation-accept-state.js";

type InvitationPageStateInput = {
  authStep: "email" | "otp";
  invitation: InvitationDetails | undefined;
  invitationErrorMessage: string | null;
  invitationId: string | null;
  invitationInviterDisplay: string | null;
  invitationOrganizationName: string | null;
  isInvitationError: boolean;
  isInvitationFetchDifferentAccount: boolean;
  isInvitationPending: boolean;
  isInvitationUnavailable: boolean;
  isSessionError: boolean;
  isSessionPending: boolean;
  isWrongAccountFromInviteLink: boolean;
  mutationError: string | null;
  decision: "idle" | "accepted" | "rejected";
  sessionExists: boolean;
};

export type InvitationPageState =
  | { kind: "missing_id"; message: string }
  | { kind: "loading_session" }
  | { kind: "session_error"; message: string }
  | { kind: "auth_required"; authStep: "email" | "otp" }
  | { kind: "wrong_account"; message: string }
  | { kind: "invitation_error"; message: string }
  | { kind: "loading_invitation" }
  | { kind: "accepted"; organizationName: string }
  | { kind: "declined" }
  | { kind: "invitation_unavailable"; message: string }
  | {
      kind: "ready";
      invitation: InvitationDetails;
      inviterDisplay: string;
      organizationName: string;
    };

export function getInvitationPageState(input: InvitationPageStateInput): InvitationPageState {
  if (input.invitationId === null || input.invitationId.length === 0) {
    return {
      kind: "missing_id",
      message: "This invitation link is invalid or can no longer be used.",
    };
  }

  if (input.isSessionPending) {
    return { kind: "loading_session" };
  }

  if (input.isSessionError) {
    return {
      kind: "session_error",
      message: "Please try again later.",
    };
  }

  if (!input.sessionExists) {
    return { kind: "auth_required", authStep: input.authStep };
  }

  if (input.isWrongAccountFromInviteLink || input.isInvitationFetchDifferentAccount) {
    return {
      kind: "wrong_account",
      message: "This invitation belongs to a different account.",
    };
  }

  if (input.decision === "accepted") {
    return {
      kind: "accepted",
      organizationName: input.invitationOrganizationName ?? "this organization",
    };
  }

  if (input.decision === "rejected") {
    return { kind: "declined" };
  }

  if (input.isInvitationUnavailable) {
    return {
      kind: "invitation_unavailable",
      message: input.mutationError ?? "This invitation is no longer available.",
    };
  }

  if (input.isInvitationError && input.invitationErrorMessage !== null) {
    return {
      kind: "invitation_error",
      message: input.invitationErrorMessage,
    };
  }

  if (input.isInvitationPending || input.invitation === undefined) {
    return { kind: "loading_invitation" };
  }

  return {
    kind: "ready",
    invitation: input.invitation,
    inviterDisplay: input.invitationInviterDisplay ?? input.invitation.inviterId,
    organizationName: input.invitationOrganizationName ?? "this organization",
  };
}
