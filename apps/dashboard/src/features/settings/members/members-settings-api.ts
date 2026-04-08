import {
  getMembershipCapabilities,
  inviteMember,
  listInvitations,
  listMemberAvatars,
  listMembers,
  removeMember,
  revokeInvitation,
  updateMemberRole,
  type InviteMemberResponse,
  type MemberAvatar,
  type MembershipCapabilities,
  type OrganizationRole,
  type SettingsInvitation,
  type SettingsMember,
} from "./members-api.js";

export type MembersSettingsApi = {
  getMembershipCapabilities: (input: { organizationId: string }) => Promise<MembershipCapabilities>;
  listMembers: (input: { organizationId: string }) => Promise<SettingsMember[]>;
  listMemberAvatars: (input: {
    organizationId: string;
    userIds: readonly string[];
  }) => Promise<MemberAvatar[]>;
  listInvitations: (input: { organizationId: string }) => Promise<SettingsInvitation[]>;
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
  listMembers,
  listMemberAvatars,
  listInvitations,
  inviteMember,
  revokeInvitation,
  updateMemberRole,
  removeMember,
};
