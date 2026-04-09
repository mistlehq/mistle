import {
  getMembershipCapabilities,
  inviteMember,
  listInvitationsPage,
  listMembersPage,
  removeMember,
  revokeInvitation,
  updateMemberRole,
  type InviteMemberResponse,
  type InvitationsPage,
  type MembersPage,
  type MembershipCapabilities,
  type OrganizationRole,
} from "./members-api.js";

export type MembersSettingsApi = {
  getMembershipCapabilities: (input: { organizationId: string }) => Promise<MembershipCapabilities>;
  listMembersPage: (input: {
    organizationId: string;
    limit: number;
    offset: number;
    search: string;
  }) => Promise<MembersPage>;
  listInvitationsPage: (input: {
    organizationId: string;
    limit: number;
    offset: number;
    search: string;
  }) => Promise<InvitationsPage>;
  inviteMember: (input: {
    organizationId: string;
    email: string;
    role: OrganizationRole;
    resend?: boolean;
  }) => Promise<InviteMemberResponse>;
  revokeInvitation: (input: { invitationId: string }) => Promise<void>;
  updateMemberRole: (input: {
    organizationId: string;
    memberId: string;
    role: OrganizationRole;
  }) => Promise<void>;
  removeMember: (input: { organizationId: string; memberIdOrEmail: string }) => Promise<void>;
};

export const defaultMembersSettingsApi: MembersSettingsApi = {
  getMembershipCapabilities,
  listMembersPage,
  listInvitationsPage,
  inviteMember,
  revokeInvitation,
  updateMemberRole,
  removeMember,
};
