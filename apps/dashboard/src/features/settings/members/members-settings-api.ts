import {
  getMembershipCapabilities,
  inviteMember,
  listMembersDirectoryPage,
  removeMember,
  revokeInvitation,
  updateMemberRole,
  type InviteMemberResponse,
  type MembersDirectoryFilter,
  type MembersDirectoryPage,
  type MembershipCapabilities,
  type OrganizationRole,
} from "./members-api.js";

export type MembersSettingsApi = {
  getMembershipCapabilities: (input: { organizationId: string }) => Promise<MembershipCapabilities>;
  listMembersDirectoryPage: (input: {
    organizationId: string;
    limit: number;
    offset: number;
    filter: MembersDirectoryFilter;
    search: string;
  }) => Promise<MembersDirectoryPage>;
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
  listMembersDirectoryPage,
  inviteMember,
  revokeInvitation,
  updateMemberRole,
  removeMember,
};
