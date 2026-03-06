import type { OrganizationRole, SettingsMember } from "./members-api.js";
export { formatDate } from "../../shared/date-formatters.js";

const ROLE_LABELS: Record<OrganizationRole, string> = {
  owner: "Owner",
  admin: "Admin",
  member: "Member",
};

export function formatRoleLabel(role: OrganizationRole): string {
  return ROLE_LABELS[role];
}

export function formatRoleSelectValue(role: OrganizationRole | null): string | undefined {
  if (role === null) {
    return undefined;
  }

  return formatRoleLabel(role);
}

export function parseRoleSelectValue(value: string | null): OrganizationRole | null {
  if (value === null) {
    return null;
  }

  if (value === "owner" || value === "admin" || value === "member") {
    return value;
  }

  return null;
}

export function resolveMemberDisplayName(input: { name: string; email: string }): string {
  const trimmedName = input.name.trim();
  if (trimmedName.length === 0) {
    return input.email;
  }

  if (trimmedName === input.email) {
    return input.email;
  }

  return trimmedName;
}

export function formatMemberDisplayName(member: Pick<SettingsMember, "name" | "email">): string {
  const displayName = resolveMemberDisplayName({
    name: member.name,
    email: member.email,
  });
  if (displayName === member.email) {
    return member.email;
  }

  return `${displayName} (${member.email})`;
}

export type InvitationDisplayStatus =
  | { kind: "pending" }
  | { kind: "expired" }
  | { kind: "accepted" }
  | { kind: "canceled" }
  | { kind: "rejected" }
  | { kind: "revoked" }
  | { kind: "unknown"; rawStatus: string };

export function invitationStatusLabel(
  role: OrganizationRole,
  displayStatus: InvitationDisplayStatus,
): string {
  const roleLabel = formatRoleLabel(role);
  if (displayStatus.kind === "pending") {
    return `${roleLabel} (Invited)`;
  }

  if (displayStatus.kind === "expired") {
    return `${roleLabel} (Invite expired)`;
  }

  if (displayStatus.kind === "accepted") {
    return `${roleLabel} (Accepted)`;
  }

  if (displayStatus.kind === "canceled") {
    return `${roleLabel} (Canceled)`;
  }

  if (displayStatus.kind === "rejected") {
    return `${roleLabel} (Rejected)`;
  }

  if (displayStatus.kind === "revoked") {
    return `${roleLabel} (Revoked)`;
  }

  return `${roleLabel} (${displayStatus.rawStatus})`;
}
