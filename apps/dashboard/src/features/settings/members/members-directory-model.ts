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

  if (invitation.status === "unknown") {
    return {
      kind: "unknown",
      rawStatus: invitation.rawStatus ?? "unknown",
    };
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
  tone: "pending" | "success" | "destructive";
};

const INVITATION_PENDING_ACTION_LABEL: Record<"resend_invite" | "revoke_invitation", string> = {
  resend_invite: "Resending invite...",
  revoke_invitation: "Revoking invitation...",
};

const INVITATION_FEEDBACK_BY_PHASE_AND_ACTION: Record<
  "pending" | "completed",
  Record<
    "resend_invite" | "revoke_invitation",
    {
      label: string;
      tone: MembersDirectoryActionFeedback["tone"];
    }
  >
> = {
  pending: {
    resend_invite: { label: "Sending...", tone: "pending" },
    revoke_invitation: { label: "Revoking...", tone: "pending" },
  },
  completed: {
    resend_invite: { label: "Sent", tone: "success" },
    revoke_invitation: { label: "Revoked", tone: "destructive" },
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
  key: "view_details" | "resend_invite" | "revoke_invitation";
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

  const descriptors: InvitationActionDescriptor[] = [
    {
      key: "view_details",
      label: "View details",
      disabled: false,
      destructive: false,
    },
  ];

  if (canResendInvitation(input.displayStatus)) {
    descriptors.push({
      key: "resend_invite",
      label: resendPending ? INVITATION_PENDING_ACTION_LABEL.resend_invite : "Resend invite",
      disabled: invitationActionsDisabled,
      destructive: false,
    });
  }

  descriptors.push({
    key: "revoke_invitation",
    label: revokePending ? INVITATION_PENDING_ACTION_LABEL.revoke_invitation : "Revoke invitation",
    disabled: invitationActionsDisabled,
    destructive: true,
  });

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
      status: string;
      date: string;
      member: SettingsMember;
    }
  | {
      kind: "invitation";
      id: string;
      name: string;
      email: string;
      status: string;
      date: string;
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
      key: "view_details";
      label: string;
      disabled: boolean;
      destructive: boolean;
      invitation: SettingsInvitation;
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

export type MembersDirectoryTableFilter = "all" | "members" | "invitations";

export const MEMBERS_DIRECTORY_TABLE_FILTER_OPTIONS: ReadonlyArray<{
  value: MembersDirectoryTableFilter;
  label: string;
}> = [
  { value: "all", label: "All" },
  { value: "members", label: "Members" },
  { value: "invitations", label: "Invitations" },
];

const MEMBERS_DIRECTORY_TABLE_FILTER_LABELS: Record<MembersDirectoryTableFilter, string> = {
  all: "All",
  members: "Members",
  invitations: "Invitations",
};

function assertNever(value: never): never {
  throw new Error(`Unexpected value: ${String(value)}`);
}

export function formatMembersDirectoryTableFilter(value: MembersDirectoryTableFilter): string {
  return MEMBERS_DIRECTORY_TABLE_FILTER_LABELS[value];
}

export function toMembersDirectoryTableFilter(value: string | null): MembersDirectoryTableFilter {
  if (value === null) {
    throw new Error("Members directory filter value must not be null.");
  }

  if (value === "all" || value === "members" || value === "invitations") {
    return value;
  }

  throw new Error(`Unexpected members directory filter value: "${value}".`);
}

export function formatMembersDirectoryRow(row: MembersDirectoryRow): {
  name: string;
  email: string;
  status: string;
  date: string;
} {
  return {
    name: row.name,
    email: row.email,
    status: row.status,
    date: formatDate(row.date),
  };
}

function compareDateDesc(leftIsoDate: string, rightIsoDate: string): number {
  const leftEpochMs = Date.parse(leftIsoDate);
  const rightEpochMs = Date.parse(rightIsoDate);
  const leftValue = Number.isFinite(leftEpochMs) ? leftEpochMs : Number.NEGATIVE_INFINITY;
  const rightValue = Number.isFinite(rightEpochMs) ? rightEpochMs : Number.NEGATIVE_INFINITY;
  return rightValue - leftValue;
}

function compareTextAsc(left: string, right: string): number {
  return left.localeCompare(right, undefined, { sensitivity: "base" });
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
    status: formatRoleLabel(member.role),
    date: member.joinedAt,
    member,
  }));

  const invitationRows: MembersDirectoryRow[] = input.invitations.map((invitation) => {
    const displayStatus = resolveInvitationDisplayStatus(invitation);
    return {
      kind: "invitation",
      id: invitation.id,
      name: invitation.email,
      email: invitation.email,
      status: invitationStatusLabel(invitation.role, displayStatus),
      date: invitation.createdAt,
      invitation,
      displayStatus,
    };
  });

  return [...memberRows, ...invitationRows].sort((left, right) => {
    const byDate = compareDateDesc(left.date, right.date);
    if (byDate !== 0) {
      return byDate;
    }

    const byName = compareTextAsc(left.name, right.name);
    if (byName !== 0) {
      return byName;
    }

    return compareTextAsc(left.email, right.email);
  });
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

function normalizeSearch(value: string): string {
  return value.trim().toLocaleLowerCase();
}

function includesSearchValue(haystack: string, searchValue: string): boolean {
  return haystack.toLocaleLowerCase().includes(searchValue);
}

function filterByTableMode(row: MembersDirectoryRow, filter: MembersDirectoryTableFilter): boolean {
  switch (filter) {
    case "all":
      return true;
    case "members":
      return row.kind === "member";
    case "invitations":
      return row.kind === "invitation";
    default:
      return assertNever(filter);
  }
}

export function filterMembersDirectoryRows(input: {
  rows: MembersDirectoryRow[];
  filter: MembersDirectoryTableFilter;
  search: string;
}): MembersDirectoryRow[] {
  const searchValue = normalizeSearch(input.search);

  return input.rows.filter((row) => {
    if (!filterByTableMode(row, input.filter)) {
      return false;
    }

    if (searchValue.length === 0) {
      return true;
    }

    return (
      includesSearchValue(row.name, searchValue) ||
      includesSearchValue(row.email, searchValue) ||
      includesSearchValue(row.status, searchValue)
    );
  });
}
