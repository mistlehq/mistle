import { Button } from "@mistle/ui";
import type { Meta, StoryObj } from "@storybook/react-vite";
import type React from "react";
import { MemoryRouter, useLocation } from "react-router";
import { expect, userEvent, within } from "storybook/test";

import { OrganizationGeneralSettingsPageView } from "../pages/organization-general-settings-page-view.js";
import { OrganizationMembersSettingsPageView } from "../pages/organization-members-settings-page-view.js";
import { ProfileSettingsPageView } from "../pages/profile-settings-page-view.js";
import type {
  MembershipCapabilities,
  SettingsInvitation,
  SettingsMember,
} from "./members/members-api.js";
import { SettingsShellView } from "./settings-shell-view.js";

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

const meta = {
  title: "Dashboard/Settings/SettingsShellView",
  component: SettingsShellView,
  parameters: {
    layout: "fullscreen",
  },
  decorators: [
    function MemoryRouterDecorator(Story): React.JSX.Element {
      return (
        <MemoryRouter>
          <Story />
        </MemoryRouter>
      );
    },
  ],
  args: {
    backLabel: "Back",
    breadcrumbs: <p className="truncate text-sm">Settings / Profile</p>,
    content: (
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
    ),
    description: "Update your name and account information.",
    headerActions: null,
    onBack: () => {},
    pathname: "/settings/account/profile",
    showBreadcrumbs: true,
    title: "Profile",
  },
} satisfies Meta<typeof SettingsShellView>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Profile: Story = {};

export const OrganizationGeneral: Story = {
  args: {
    breadcrumbs: <p className="truncate text-sm">Settings / Organization / General</p>,
    content: (
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
    ),
    description: "Manage the organization name and defaults.",
    pathname: "/settings/organization/general",
    title: "General",
  },
};

export const OrganizationMembers: Story = {
  args: {
    breadcrumbs: <p className="truncate text-sm">Settings / Organization / Members</p>,
    content: (
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
    ),
    description: "Invite members, update roles, and review pending invitations.",
    headerActions: (
      <Button size="sm" type="button">
        Invite members
      </Button>
    ),
    pathname: "/settings/organization/members",
    title: "Members",
  },
};

function InteractiveSettingsShell(): React.JSX.Element {
  const location = useLocation();

  if (location.pathname === "/settings/organization/general") {
    return (
      <SettingsShellView
        backLabel="Back"
        breadcrumbs={<p className="truncate text-sm">Settings / Organization / General</p>}
        content={
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
        }
        description="Manage the organization name and defaults."
        headerActions={null}
        onBack={() => {}}
        pathname={location.pathname}
        showBreadcrumbs
        title="General"
      />
    );
  }

  if (location.pathname === "/settings/organization/members") {
    return (
      <SettingsShellView
        backLabel="Back"
        breadcrumbs={<p className="truncate text-sm">Settings / Organization / Members</p>}
        content={
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
        }
        description="Invite members, update roles, and review pending invitations."
        headerActions={
          <Button size="sm" type="button">
            Invite members
          </Button>
        }
        onBack={() => {}}
        pathname={location.pathname}
        showBreadcrumbs
        title="Members"
      />
    );
  }

  return (
    <SettingsShellView
      backLabel="Back"
      breadcrumbs={<p className="truncate text-sm">Settings / Profile</p>}
      content={
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
      }
      description="Update your name and account information."
      headerActions={null}
      onBack={() => {}}
      pathname={location.pathname}
      showBreadcrumbs
      title="Profile"
    />
  );
}

export const InteractiveNavigation: Story = {
  decorators: [
    function MemoryRouterDecorator(Story): React.JSX.Element {
      return (
        <MemoryRouter initialEntries={["/settings/account/profile"]}>
          <Story />
        </MemoryRouter>
      );
    },
  ],
  render: function RenderStory(): React.JSX.Element {
    return <InteractiveSettingsShell />;
  },
  play: async ({ canvasElement }): Promise<void> => {
    const body = within(canvasElement.ownerDocument.body);

    await expect(body.getByRole("heading", { name: "Profile" })).toBeVisible();
    await expect(body.getByLabelText("Display name")).toBeVisible();

    await userEvent.click(body.getByRole("link", { name: "General" }));
    await expect(body.getByRole("heading", { name: "General" })).toBeVisible();
    await expect(body.getByLabelText("Organization name")).toBeVisible();

    await userEvent.click(body.getByRole("link", { name: "Members" }));
    await expect(body.getByRole("heading", { name: "Members" })).toBeVisible();
    await expect(body.getByRole("button", { name: "Invite members" })).toBeVisible();
    await expect(body.getByText("owner@mistle.so")).toBeVisible();

    await userEvent.click(body.getByRole("link", { name: "Profile" }));
    await expect(body.getByRole("heading", { name: "Profile" })).toBeVisible();
    await expect(body.getByDisplayValue("Mistle Developer")).toBeVisible();
  },
};
