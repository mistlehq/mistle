import { Button } from "@mistle/ui";
import type React from "react";

import { OrganizationGeneralSettingsPageView } from "../pages/organization-general-settings-page-view.js";
import { OrganizationMembersSettingsPageView } from "../pages/organization-members-settings-page-view.js";
import {
  createOrganizationMembersSettingsPageStoryViewModel,
  inviteOrganizationMemberStoryRequest,
  OrganizationMembersStoryCapabilities,
  OrganizationMembersStoryMembers,
} from "../pages/organization-members-settings-page-view.story-fixtures.js";
import { ProfileSettingsPageView } from "../pages/profile-settings-page-view.js";

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
      pendingLinkedAccountProviderFamilies={[]}
      linkedAccountCallbackNotice={null}
      linkedAccountCards={[]}
      linkedAccountErrorMessage={null}
      linkedAccountsEmptyStateMessage={null}
      linkedAccountsLoading={false}
      linkedAccountsLoadErrorMessage={null}
      onDeleteLinkedAccountCommitSigningKey={async () => {}}
      onDeleteProfileImage={async () => {}}
      onLinkLinkedAccount={async () => {}}
      onSaveChanges={async () => {}}
      onUnlinkLinkedAccount={async () => {}}
      onUpdateLinkedAccountPreferredEmail={async () => {}}
      onUploadLinkedAccountCommitSigningKey={async () => {}}
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
      viewModel={createOrganizationMembersSettingsPageStoryViewModel({
        capabilities: OrganizationMembersStoryCapabilities,
        invitations: [],
        inviteMemberRequest: inviteOrganizationMemberStoryRequest,
        members: OrganizationMembersStoryMembers,
        total: OrganizationMembersStoryMembers.length,
      })}
    />
  );
}
