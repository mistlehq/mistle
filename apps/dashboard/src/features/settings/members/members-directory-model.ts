import { systemClock } from "@mistle/time";

import type { MembershipCapabilities, SettingsInvitation, SettingsMember } from "./members-api.js";
import {
  formatDate,
  formatRoleLabel,
  invitationStatusLabel,
  resolveMemberDisplayName,
  type InvitationDisplayStatus,
} from "./members-formatters.js";

export function resolveInvitationDisplayStatus(
  invitation: SettingsInvitation,
): InvitationDisplayStatus {
  if (invitation.status === "accepted") {
    return { kind: "accepted" };
  }

  if (invitation.status === "canceled") {
    return { kind: "canceled" };
  }

  if (invitation.status === "rejected") {
    return { kind: "rejected" };
  }

  if (invitation.status === "revoked") {
    return { kind: "revoked" };
  }

  const expiresAtEpochMs = Date.parse(invitation.expiresAt);
  if (!Number.isFinite(expiresAtEpochMs)) {
    return { kind: "pending" };
  }

  if (expiresAtEpochMs < systemClock.nowMs()) {
    return { kind: "expired" };
  }

  return { kind: "pending" };
}

export function canResendInvitation(displayStatus: InvitationDisplayStatus): boolean {
  return displayStatus.kind === "pending" || displayStatus.kind === "expired";
}

export function canRevokeInvitation(displayStatus: InvitationDisplayStatus): boolean {
  return displayStatus.kind === "pending" || displayStatus.kind === "expired";
}

export type MembersDirectoryPendingMemberOperation =
  | { kind: "change_role"; memberId: string }
  | { kind: "remove_member"; memberId: string }
  | null;

export type MembersDirectoryInvitationActionState = {
  invitationId: string;
  action: "resend_invite" | "revoke_invitation";
  phase: "pending" | "completed";
} | null;

export type MembersDirectoryActionFeedback = {
  label: string;
  state:
    | "resend_invite_pending"
    | "resend_invite_completed"
    | "revoke_invitation_pending"
    | "revoke_invitation_completed";
  tone: "pending" | "success" | "destructive";
};

const INVITATION_PENDING_ACTION_LABEL: Record<"resend_invite" | "revoke_invitation", string> = {
  resend_invite: "Resending invite...",
  revoke_invitation: "Canceling invitation...",
};

const INVITATION_FEEDBACK_BY_PHASE_AND_ACTION: Record<
  "pending" | "completed",
  Record<
    "resend_invite" | "revoke_invitation",
    {
      label: string;
      state: MembersDirectoryActionFeedback["state"];
      tone: MembersDirectoryActionFeedback["tone"];
    }
  >
> = {
  pending: {
    resend_invite: {
      label: "Sending...",
      state: "resend_invite_pending",
      tone: "pending",
    },
    revoke_invitation: {
      label: "Revoking...",
      state: "revoke_invitation_pending",
      tone: "pending",
    },
  },
  completed: {
    resend_invite: {
      label: "Sent",
      state: "resend_invite_completed",
      tone: "success",
    },
    revoke_invitation: {
      label: "Canceled",
      state: "revoke_invitation_completed",
      tone: "destructive",
    },
  },
};

export function isInvitationActionDisabled(input: {
  canManageInvitations: boolean;
  invitationId: string;
  invitationActionState: MembersDirectoryInvitationActionState;
}): boolean {
  if (!input.canManageInvitations) {
    return true;
  }

  if (input.invitationActionState === null) {
    return false;
  }

  return input.invitationActionState.invitationId === input.invitationId;
}

export type MemberActionDescriptor = {
  key: "change_role" | "remove_member";
  label: string;
  disabled: boolean;
  destructive: boolean;
};

export function buildMemberActionDescriptors(input: {
  member: SettingsMember;
  capabilities: MembershipCapabilities | null;
  pendingMemberOperation: MembersDirectoryPendingMemberOperation;
}): MemberActionDescriptor[] {
  const roleTransitions =
    input.capabilities?.memberRoleUpdate.roleTransitionMatrix[input.member.role] ?? [];
  const canExecute = input.capabilities?.memberRoleUpdate.canExecute === true;
  const canChangeRole = canExecute && roleTransitions.length > 0;
  const canRemove = canExecute;
  const roleChangePending =
    input.pendingMemberOperation?.kind === "change_role" &&
    input.pendingMemberOperation.memberId === input.member.id;
  const removePending =
    input.pendingMemberOperation?.kind === "remove_member" &&
    input.pendingMemberOperation.memberId === input.member.id;

  const descriptors: MemberActionDescriptor[] = [];
  if (canChangeRole) {
    descriptors.push({
      key: "change_role",
      label: roleChangePending ? "Updating role..." : "Change role",
      disabled: roleChangePending || removePending,
      destructive: false,
    });
  }

  if (canRemove) {
    descriptors.push({
      key: "remove_member",
      label: removePending ? "Removing member..." : "Remove member",
      disabled: removePending || roleChangePending,
      destructive: true,
    });
  }

  return descriptors;
}

export type InvitationActionDescriptor = {
  key: "resend_invite" | "revoke_invitation";
  label: string;
  disabled: boolean;
  destructive: boolean;
};

export function buildInvitationActionDescriptors(input: {
  displayStatus: InvitationDisplayStatus;
  canManageInvitations: boolean;
  invitationId: string;
  invitationActionState: MembersDirectoryInvitationActionState;
}): InvitationActionDescriptor[] {
  const invitationActionsDisabled = isInvitationActionDisabled({
    canManageInvitations: input.canManageInvitations,
    invitationId: input.invitationId,
    invitationActionState: input.invitationActionState,
  });
  const resendPending =
    input.invitationActionState?.phase === "pending" &&
    input.invitationActionState.action === "resend_invite" &&
    input.invitationActionState.invitationId === input.invitationId;
  const revokePending =
    input.invitationActionState?.phase === "pending" &&
    input.invitationActionState.action === "revoke_invitation" &&
    input.invitationActionState.invitationId === input.invitationId;

  const descriptors: InvitationActionDescriptor[] = [];

  if (canResendInvitation(input.displayStatus)) {
    descriptors.push({
      key: "resend_invite",
      label: resendPending ? INVITATION_PENDING_ACTION_LABEL.resend_invite : "Resend invite",
      disabled: invitationActionsDisabled,
      destructive: false,
    });
  }

  if (canRevokeInvitation(input.displayStatus)) {
    descriptors.push({
      key: "revoke_invitation",
      label: revokePending
        ? INVITATION_PENDING_ACTION_LABEL.revoke_invitation
        : "Cancel invitation",
      disabled: invitationActionsDisabled,
      destructive: true,
    });
  }

  return descriptors;
}

export function resolveInvitationActionFeedback(input: {
  invitationId: string;
  invitationActionState: MembersDirectoryInvitationActionState;
}): MembersDirectoryActionFeedback | null {
  if (
    input.invitationActionState === null ||
    input.invitationActionState.invitationId !== input.invitationId
  ) {
    return null;
  }

  return INVITATION_FEEDBACK_BY_PHASE_AND_ACTION[input.invitationActionState.phase][
    input.invitationActionState.action
  ];
}

export type MembersDirectoryRow =
  | {
      kind: "member";
      id: string;
      name: string;
      email: string;
      role: string;
      status: null;
      date: string;
      invitedBy: null;
      expiresAt: null;
      member: SettingsMember;
    }
  | {
      kind: "invitation";
      id: string;
      name: string;
      email: string;
      role: string;
      status: string;
      date: string;
      invitedBy: string;
      expiresAt: string;
      invitation: SettingsInvitation;
      displayStatus: InvitationDisplayStatus;
    };

export type MembersDirectoryActionDescriptor =
  | {
      key: "change_role";
      label: string;
      disabled: boolean;
      destructive: boolean;
      member: SettingsMember;
    }
  | {
      key: "remove_member";
      label: string;
      disabled: boolean;
      destructive: boolean;
      member: SettingsMember;
    }
  | {
      key: "resend_invite";
      label: string;
      disabled: boolean;
      destructive: boolean;
      invitation: SettingsInvitation;
    }
  | {
      key: "revoke_invitation";
      label: string;
      disabled: boolean;
      destructive: boolean;
      invitation: SettingsInvitation;
    };

export function formatMembersDirectoryRow(row: MembersDirectoryRow): {
  name: string;
  email: string;
  role: string;
  status: string | null;
  date: string;
  invitedBy: string | null;
  expiresAt: string | null;
} {
  return {
    name: row.name,
    email: row.email,
    role: row.role,
    status: row.status,
    date: formatDate(row.date),
    invitedBy: row.invitedBy,
    expiresAt: row.expiresAt === null ? null : formatDate(row.expiresAt),
  };
}

export function buildMembersDirectoryRows(input: {
  members: SettingsMember[];
  invitations: SettingsInvitation[];
}): MembersDirectoryRow[] {
  const memberRows: MembersDirectoryRow[] = input.members.map((member) => ({
    kind: "member",
    id: member.id,
    name: resolveMemberDisplayName({
      name: member.name,
      email: member.email,
    }),
    email: member.email,
    role: formatRoleLabel(member.role),
    status: null,
    date: member.joinedAt,
    invitedBy: null,
    expiresAt: null,
    member,
  }));

  const invitationRows: MembersDirectoryRow[] = input.invitations.map((invitation) => {
    const displayStatus = resolveInvitationDisplayStatus(invitation);
    return {
      kind: "invitation",
      id: invitation.id,
      name: invitation.email,
      email: invitation.email,
      role: formatRoleLabel(invitation.role),
      status: invitationStatusLabel(displayStatus),
      date: invitation.createdAt,
      invitedBy: invitation.inviterName,
      expiresAt: invitation.expiresAt,
      invitation,
      displayStatus,
    };
  });

  return [...memberRows, ...invitationRows];
}

export function buildMembersDirectoryRowActionDescriptors(input: {
  row: MembersDirectoryRow;
  capabilities: MembershipCapabilities | null;
  canManageInvitations: boolean;
  pendingMemberOperation: MembersDirectoryPendingMemberOperation;
  invitationActionState: MembersDirectoryInvitationActionState;
}): MembersDirectoryActionDescriptor[] {
  if (input.row.kind === "member") {
    const member = input.row.member;
    const memberActions = buildMemberActionDescriptors({
      member,
      capabilities: input.capabilities,
      pendingMemberOperation: input.pendingMemberOperation,
    });

    return memberActions.map((action) => ({
      ...action,
      member,
    }));
  }

  const invitation = input.row.invitation;
  const invitationActions = buildInvitationActionDescriptors({
    displayStatus: input.row.displayStatus,
    canManageInvitations: input.canManageInvitations,
    invitationId: invitation.id,
    invitationActionState: input.invitationActionState,
  });

  return invitationActions.map((action) => ({
    ...action,
    invitation,
  }));
}

export function directoryRowActionsLabel(row: MembersDirectoryRow): string {
  if (row.kind === "member") {
    return "Member actions";
  }

  return "Invitation actions";
}

export function directoryRowActionsContentClassName(row: MembersDirectoryRow): string | undefined {
  if (row.kind === "invitation") {
    return "min-w-44";
  }

  return undefined;
}
