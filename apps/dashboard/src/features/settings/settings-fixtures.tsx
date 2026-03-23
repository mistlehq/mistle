import { Button } from "@mistle/ui";
import type React from "react";

import { OrganizationGeneralSettingsPageView } from "../pages/organization-general-settings-page-view.js";
import { OrganizationMembersSettingsPageView } from "../pages/organization-members-settings-page-view.js";
import { ProfileSettingsPageView } from "../pages/profile-settings-page-view.js";
import type {
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
    status: "pending",
    rawStatus: null,
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
      displayNameDraft="Mistle Developer"
      email="developer@mistle.so"
      fieldError={null}
      hasDirtyChanges={false}
      onCancelChanges={() => {}}
      onDisplayNameChange={() => {}}
      onSaveChanges={() => {}}
      saveSuccess={false}
      saving={false}
    />
  );
}

export function createOrganizationGeneralSettingsFixtureContent(): React.JSX.Element {
  return (
    <OrganizationGeneralSettingsPageView
      hasDirtyChanges={false}
      isLoading={false}
      isSaving={false}
      loadErrorMessage={null}
      name="Mistle Labs"
      nameErrorMessage={null}
      onCancelChanges={() => {}}
      onNameChange={() => {}}
      onRetryLoad={() => {}}
      onSaveChanges={() => {}}
      saveErrorMessage={null}
      saveSuccess={false}
    />
  );
}

export function createOrganizationMembersSettingsFixtureContent(): React.JSX.Element {
  return (
    <OrganizationMembersSettingsPageView
      capabilities={SettingsFixtureCapabilities}
      capabilitiesErrorMessage={null}
      invitationActionState={null}
      invitations={SettingsFixtureInvitations}
      inviteDialogOpen={false}
      inviteMemberRequest={queueSettingsFixtureInviteMemberRequest}
      isLoading={false}
      isUpdatingRole={false}
      loadErrorMessage={null}
      members={SettingsFixtureMembers}
      onChangeRole={() => {}}
      onInviteCompleted={async () => {}}
      onInviteDialogOpenChange={() => {}}
      onRemoveMember={() => {}}
      onResendInvite={() => {}}
      onRetryCapabilities={() => {}}
      onRetryLoad={() => {}}
      onRevokeInvite={() => {}}
      onRoleDialogCancel={() => {}}
      onRoleDialogOpenChange={() => {}}
      onRoleSelectValueChange={() => {}}
      onSaveRole={() => {}}
      organizationId="org_storybook"
      pendingMemberOperation={null}
      resolveInviterDisplayName={() => "Product Lead"}
      roleChangeDialog={null}
      roleUpdateErrorMessage={null}
    />
  );
}
