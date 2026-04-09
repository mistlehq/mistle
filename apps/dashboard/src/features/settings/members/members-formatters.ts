import type { OrganizationRole, SettingsMember } from "./members-api.js";
export { formatDate } from "../../shared/date-formatters.js";
import { formatUserDisplayName, resolveUserDisplayName } from "../../shared/user-display-name.js";

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
  return resolveUserDisplayName(input);
}

export function formatMemberDisplayName(member: Pick<SettingsMember, "name" | "email">): string {
  return formatUserDisplayName(member);
}

export type InvitationDisplayStatus =
  | { kind: "pending" }
  | { kind: "expired" }
  | { kind: "accepted" }
  | { kind: "canceled" }
  | { kind: "rejected" }
  | { kind: "revoked" };

export function invitationStatusLabel(displayStatus: InvitationDisplayStatus): string {
  if (displayStatus.kind === "pending") {
    return "Pending";
  }

  if (displayStatus.kind === "expired") {
    return "Expired";
  }

  if (displayStatus.kind === "accepted") {
    return "Accepted";
  }

  if (displayStatus.kind === "canceled") {
    return "Canceled";
  }

  if (displayStatus.kind === "rejected") {
    return "Rejected";
  }

  if (displayStatus.kind === "revoked") {
    return "Revoked";
  }

  throw new Error("Unhandled invitation display status.");
}
