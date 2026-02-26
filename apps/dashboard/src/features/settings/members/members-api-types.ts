export type OrganizationRole = "owner" | "admin" | "member";

export type MembershipCapabilities = {
  organizationId: string;
  actorRole: OrganizationRole;
  invite: {
    canExecute: boolean;
    assignableRoles: OrganizationRole[];
  };
  memberRoleUpdate: {
    canExecute: boolean;
    roleTransitionMatrix: Record<OrganizationRole, OrganizationRole[]>;
  };
};

export type SettingsMember = {
  id: string;
  userId: string;
  name: string;
  email: string;
  role: OrganizationRole;
  joinedAt: string;
};

export type SettingsInvitation = {
  id: string;
  organizationId: string;
  email: string;
  role: OrganizationRole;
  inviterId: string;
  status: InvitationStatus;
  rawStatus: string | null;
  expiresAt: string;
  createdAt: string;
};

export type InvitationStatus =
  | "pending"
  | "accepted"
  | "canceled"
  | "rejected"
  | "revoked"
  | "unknown";

export type InviteMemberResponse = {
  status: string | null;
  message: string | null;
  code: string | null;
  raw: unknown;
};
