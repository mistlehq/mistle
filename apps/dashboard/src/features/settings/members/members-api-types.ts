import type { paths } from "../../../lib/control-plane-api/generated/schema.js";

export type MembershipCapabilitiesResponse =
  paths["/v1/organization/membership-capabilities"]["get"]["responses"][200]["content"]["application/json"];
export type MembershipCapabilities = MembershipCapabilitiesResponse;
export type OrganizationRole = MembershipCapabilities["actorRole"];
export type MemberAvatar = {
  userId: string;
  hasImage: boolean;
  imageUrl: string | null;
};

export type MembersDirectoryFilter = "members" | "invitations";

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
  inviterName: string;
  status: InvitationStatus;
  expiresAt: string;
  createdAt: string;
};

export type InvitationStatus = "pending" | "accepted" | "canceled" | "rejected" | "revoked";

export type InviteMemberResponse = {
  status: string | null;
  message: string | null;
  code: string | null;
  raw: unknown;
};

export type MembersPage = {
  members: SettingsMember[];
  memberAvatarsByUserId: ReadonlyMap<string, MemberAvatar>;
  limit: number;
  offset: number;
  total: number;
};

export type InvitationsPage = {
  invitations: SettingsInvitation[];
  limit: number;
  offset: number;
  total: number;
};
