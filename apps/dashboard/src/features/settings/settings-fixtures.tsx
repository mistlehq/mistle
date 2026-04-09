import { Button } from "@mistle/ui";
import type React from "react";

import { OrganizationGeneralSettingsPageView } from "../pages/organization-general-settings-page-view.js";
import { OrganizationMembersSettingsPageView } from "../pages/organization-members-settings-page-view.js";
import { ProfileSettingsPageView } from "../pages/profile-settings-page-view.js";
import type {
  MemberAvatar,
  MembershipCapabilities,
  SettingsInvitation,
  SettingsMember,
} from "./members/members-api.js";

export const SettingsFixtureCapabilities: MembershipCapabilities = {
  organizationId: "org_storybook",
  actorRole: "admin",
  invite: {
    canExecute: true,
    assignableRoles: ["admin", "member"],
  },
  memberRoleUpdate: {
    canExecute: true,
    roleTransitionMatrix: {
      owner: [],
      admin: ["admin", "member"],
      member: ["admin", "member"],
    },
  },
};

export const SettingsFixtureMembers: SettingsMember[] = [
  {
    id: "mem_owner",
    userId: "user_owner",
    name: "Mistle Owner",
    email: "owner@mistle.so",
    role: "owner",
    joinedAt: "2026-01-01T00:00:00.000Z",
  },
  {
    id: "mem_product",
    userId: "user_product",
    name: "Product Lead",
    email: "product@mistle.so",
    role: "admin",
    joinedAt: "2026-02-04T00:00:00.000Z",
  },
];

export const SettingsFixtureInvitations: SettingsInvitation[] = [
  {
    id: "inv_pending",
    organizationId: "org_storybook",
    email: "pending@mistle.so",
    role: "member",
    inviterId: "user_product",
    inviterName: "Product Lead",
    status: "pending",
    expiresAt: "2026-12-31T00:00:00.000Z",
    createdAt: "2026-03-01T00:00:00.000Z",
  },
];

export async function queueSettingsFixtureInviteMemberRequest(): Promise<{
  status: string | null;
  message: string | null;
  code: string | null;
  raw: unknown;
}> {
  return {
    status: "queued",
    message: null,
    code: null,
    raw: null,
  };
}

export function createSettingsFixtureInviteMembersButton(): React.JSX.Element {
  return (
    <Button size="sm" type="button">
      Invite members
    </Button>
  );
}

export function createProfileSettingsFixtureContent(): React.JSX.Element {
  return (
    <ProfileSettingsPageView
      displayName="Mistle Developer"
      email="developer@mistle.so"
      imageUrl={null}
      onDeleteProfileImage={async () => {}}
      onSaveChanges={async () => {}}
      onUploadProfileImage={async () => {}}
      profileImageBusy={false}
      profileImageErrorMessage={null}
      saving={false}
    />
  );
}

export function createOrganizationGeneralSettingsFixtureContent(): React.JSX.Element {
  return (
    <OrganizationGeneralSettingsPageView
      isLoading={false}
      isSaving={false}
      loadErrorMessage={null}
      logoBusy={false}
      logoErrorMessage={null}
      logoUrl={null}
      name="Mistle Labs"
      onDeleteLogo={async () => {}}
      onSaveChanges={async () => {}}
      onUploadLogo={async () => {}}
    />
  );
}

export function createOrganizationMembersSettingsFixtureContent(): React.JSX.Element {
  return (
    <OrganizationMembersSettingsPageView
      activeFilter="members"
      capabilities={SettingsFixtureCapabilities}
      capabilitiesErrorMessage={null}
      hasNextPage={false}
      hasPreviousPage={false}
      invitationActionState={null}
      invitations={[]}
      inviteDialogOpen={false}
      inviteMemberRequest={queueSettingsFixtureInviteMemberRequest}
      inviteMembersDisabled={false}
      isLoading={false}
      isListFetching={false}
      isUpdatingRole={false}
      limit={25}
      listErrorNoticeMessage={null}
      loadErrorMessage={null}
      memberAvatarsByUserId={new Map<string, MemberAvatar>()}
      members={SettingsFixtureMembers}
      onChangeRole={() => {}}
      onInviteCompleted={async () => {}}
      onInviteDialogOpenChange={() => {}}
      onFilterChange={() => {}}
      onNextPage={() => {}}
      onPreviousPage={() => {}}
      onSearchValueChange={() => {}}
      onRemoveMember={() => {}}
      onResendInvite={() => {}}
      onRevokeInvite={() => {}}
      onRoleDialogCancel={() => {}}
      onRoleDialogOpenChange={() => {}}
      onRoleSelectValueChange={() => {}}
      onSaveRole={() => {}}
      organizationId="org_storybook"
      offset={0}
      pendingMemberOperation={null}
      roleChangeDialog={null}
      roleUpdateErrorMessage={null}
      searchValue=""
      total={SettingsFixtureMembers.length}
    />
  );
}
