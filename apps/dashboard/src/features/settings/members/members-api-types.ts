import type { paths } from "../../../lib/control-plane-api/generated/schema.js";

export type MembershipCapabilitiesResponse =
  paths["/v1/organizations/{organizationId}/membership-capabilities"]["get"]["responses"][200]["content"]["application/json"];
export type MembershipCapabilities = MembershipCapabilitiesResponse["data"];
export type OrganizationRole = MembershipCapabilities["actorRole"];

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
