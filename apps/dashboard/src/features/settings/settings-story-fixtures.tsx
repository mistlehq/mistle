import { Button } from "@mistle/ui";
import type React from "react";
import { useLocation } from "react-router";

import { OrganizationGeneralSettingsPageView } from "../pages/organization-general-settings-page-view.js";
import { OrganizationMembersSettingsPageView } from "../pages/organization-members-settings-page-view.js";
import { ProfileSettingsPageView } from "../pages/profile-settings-page-view.js";
import type {
  MembershipCapabilities,
  SettingsInvitation,
  SettingsMember,
} from "./members/members-api.js";
import type { SettingsShellViewProps } from "./settings-shell-view.js";
import { SettingsShellView } from "./settings-shell-view.js";

export const SettingsStoryPathnames = {
  ACCOUNT_PROFILE: "/settings/account/profile",
  ORGANIZATION_GENERAL: "/settings/organization/general",
  ORGANIZATION_INTEGRATIONS: "/settings/organization/integrations",
  ORGANIZATION_MEMBERS: "/settings/organization/members",
} as const;

const DemoCapabilities: MembershipCapabilities = {
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

const DemoMembers: SettingsMember[] = [
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

const DemoInvitations: SettingsInvitation[] = [
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

async function inviteMemberRequest(): Promise<{
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

function createStoryBreadcrumb(text: string): React.JSX.Element {
  return <p className="truncate text-sm">{text}</p>;
}

function createInviteMembersButton(): React.JSX.Element {
  return (
    <Button size="sm" type="button">
      Invite members
    </Button>
  );
}

function createProfileSettingsContent(): React.JSX.Element {
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

function createOrganizationGeneralContent(): React.JSX.Element {
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

function createOrganizationMembersContent(): React.JSX.Element {
  return (
    <OrganizationMembersSettingsPageView
      capabilities={DemoCapabilities}
      capabilitiesErrorMessage={null}
      invitationActionState={null}
      invitations={DemoInvitations}
      inviteDialogOpen={false}
      inviteMemberRequest={inviteMemberRequest}
      isLoading={false}
      isUpdatingRole={false}
      loadErrorMessage={null}
      members={DemoMembers}
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

export function createSettingsShellStoryArgs(pathname: string): SettingsShellViewProps {
  if (pathname === SettingsStoryPathnames.ACCOUNT_PROFILE) {
    return {
      backLabel: "Back",
      breadcrumbs: createStoryBreadcrumb("Settings / Profile"),
      content: createProfileSettingsContent(),
      headerActions: null,
      onBack: () => {},
      pathname,
      showBreadcrumbs: true,
      supportingText: "Update your name and account information.",
      title: "Profile",
    };
  }

  if (pathname === SettingsStoryPathnames.ORGANIZATION_GENERAL) {
    return {
      backLabel: "Back",
      breadcrumbs: createStoryBreadcrumb("Settings / Organization / General"),
      content: createOrganizationGeneralContent(),
      headerActions: null,
      onBack: () => {},
      pathname,
      showBreadcrumbs: true,
      supportingText: "Manage the organization name and defaults.",
      title: "General",
    };
  }

  if (pathname === SettingsStoryPathnames.ORGANIZATION_MEMBERS) {
    return {
      backLabel: "Back",
      breadcrumbs: createStoryBreadcrumb("Settings / Organization / Members"),
      content: createOrganizationMembersContent(),
      headerActions: createInviteMembersButton(),
      onBack: () => {},
      pathname,
      showBreadcrumbs: true,
      supportingText: "Invite members, update roles, and review pending invitations.",
      title: "Members",
    };
  }

  throw new Error(`Unsupported settings story pathname: ${pathname}`);
}

export function SettingsShellStoryForLocation(): React.JSX.Element {
  const location = useLocation();

  return <SettingsShellView {...createSettingsShellStoryArgs(location.pathname)} />;
}
