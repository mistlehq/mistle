import { Button } from "@mistle/ui";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import type React from "react";
import { expect, userEvent, within } from "storybook/test";

import { withDashboardPageWidth } from "../../storybook/decorators.js";
import type {
  MembershipCapabilities,
  SettingsInvitation,
  SettingsMember,
} from "../settings/members/members-api.js";
import type { RoleChangeDialogState } from "../settings/members/members-capability-policy.js";
import type { MembersDirectoryInvitationActionState } from "../settings/members/members-directory-model.js";
import { OrganizationMembersSettingsPageView } from "./organization-members-settings-page-view.js";

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
  {
    id: "mem_storybook",
    userId: "user_storybook",
    name: "Storybook Tester",
    email: "storybook@mistle.so",
    role: "member",
    joinedAt: "2026-02-14T00:00:00.000Z",
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
  {
    id: "inv_revoked",
    organizationId: "org_storybook",
    email: "revoked@mistle.so",
    role: "admin",
    inviterId: "user_owner",
    status: "revoked",
    rawStatus: null,
    expiresAt: "2026-03-05T00:00:00.000Z",
    createdAt: "2026-02-20T00:00:00.000Z",
  },
];

function requireMember(memberId: string): SettingsMember {
  const member = DemoMembers.find((entry) => entry.id === memberId);
  if (member === undefined) {
    throw new Error(`Missing demo member: ${memberId}`);
  }

  return member;
}

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
  title: "Dashboard/Pages/OrganizationMembersSettingsPageView",
  component: OrganizationMembersSettingsPageView,
  decorators: [
    withDashboardPageWidth,
    function HeaderDecorator(Story, context): React.JSX.Element {
      const args = context.args;

      return (
        <div className="flex flex-col gap-4">
          <div className="flex justify-end">
            <Button
              disabled={
                args.capabilitiesErrorMessage !== null ||
                args.capabilities === null ||
                args.capabilities.invite.canExecute !== true
              }
              onClick={() => {
                args.onInviteDialogOpenChange(true);
              }}
              type="button"
            >
              Invite members
            </Button>
          </div>
          <Story />
        </div>
      );
    },
  ],
  args: {
    capabilities: DemoCapabilities,
    capabilitiesErrorMessage: null,
    invitationActionState: null,
    invitations: DemoInvitations,
    inviteDialogOpen: false,
    inviteMemberRequest,
    isLoading: false,
    isUpdatingRole: false,
    loadErrorMessage: null,
    members: DemoMembers,
    onChangeRole: () => {},
    onInviteCompleted: async () => {},
    onInviteDialogOpenChange: () => {},
    onRemoveMember: () => {},
    onResendInvite: () => {},
    onRetryCapabilities: () => {},
    onRetryLoad: () => {},
    onRevokeInvite: () => {},
    onRoleDialogCancel: () => {},
    onRoleDialogOpenChange: () => {},
    onRoleSelectValueChange: () => {},
    onSaveRole: () => {},
    organizationId: "org_storybook",
    pendingMemberOperation: null,
    resolveInviterDisplayName: (inviterId: string) => {
      const inviter = DemoMembers.find((member) => member.userId === inviterId);
      return inviter?.name ?? inviterId;
    },
    roleChangeDialog: null,
    roleUpdateErrorMessage: null,
  },
} satisfies Meta<typeof OrganizationMembersSettingsPageView>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Loading: Story = {
  args: {
    isLoading: true,
  },
};

export const LoadError: Story = {
  args: {
    loadErrorMessage: "Failed to load members.",
  },
};

export const Default: Story = {};

export const CapabilitiesWarning: Story = {
  args: {
    capabilities: null,
    capabilitiesErrorMessage: "Membership permissions could not be loaded.",
  },
};

export const InviteDialogOpen: Story = {
  args: {
    inviteDialogOpen: true,
  },
};

export const RoleDialogOpen: Story = {
  args: {
    roleChangeDialog: {
      member: requireMember("mem_storybook"),
      selectedRole: "admin",
      allowedRoles: ["admin", "member"],
    },
  },
};

export const PendingActions: Story = {
  args: {
    invitationActionState: {
      invitationId: "inv_pending",
      action: "resend_invite",
      phase: "pending",
    },
    pendingMemberOperation: {
      kind: "change_role",
      memberId: "mem_storybook",
    },
  },
};

export const InteractiveFiltering: Story = {
  render: function RenderStory(): React.JSX.Element {
    const [inviteDialogOpen, setInviteDialogOpen] = useState(false);
    const [roleChangeDialog, setRoleChangeDialog] = useState<RoleChangeDialogState | null>(null);
    const [invitationActionState, setInvitationActionState] =
      useState<MembersDirectoryInvitationActionState>(null);

    return (
      <OrganizationMembersSettingsPageView
        capabilities={DemoCapabilities}
        capabilitiesErrorMessage={null}
        invitationActionState={invitationActionState}
        invitations={DemoInvitations}
        inviteDialogOpen={inviteDialogOpen}
        inviteMemberRequest={inviteMemberRequest}
        isLoading={false}
        isUpdatingRole={false}
        loadErrorMessage={null}
        members={DemoMembers}
        onChangeRole={(member) => {
          setRoleChangeDialog({
            member,
            selectedRole: member.role === "member" ? "admin" : member.role,
            allowedRoles: ["admin", "member"],
          });
        }}
        onInviteCompleted={async () => {}}
        onInviteDialogOpenChange={setInviteDialogOpen}
        onRemoveMember={() => {}}
        onResendInvite={(invitation) => {
          setInvitationActionState({
            invitationId: invitation.id,
            action: "resend_invite",
            phase: "completed",
          });
        }}
        onRetryCapabilities={() => {}}
        onRetryLoad={() => {}}
        onRevokeInvite={(invitation) => {
          setInvitationActionState({
            invitationId: invitation.id,
            action: "revoke_invitation",
            phase: "completed",
          });
        }}
        onRoleDialogCancel={() => {
          setRoleChangeDialog(null);
        }}
        onRoleDialogOpenChange={(nextOpen) => {
          if (!nextOpen) {
            setRoleChangeDialog(null);
          }
        }}
        onRoleSelectValueChange={() => {}}
        onSaveRole={() => {
          setRoleChangeDialog(null);
        }}
        organizationId="org_storybook"
        pendingMemberOperation={null}
        resolveInviterDisplayName={(inviterId: string) => {
          const inviter = DemoMembers.find((member) => member.userId === inviterId);
          return inviter?.name ?? inviterId;
        }}
        roleChangeDialog={roleChangeDialog}
        roleUpdateErrorMessage={null}
      />
    );
  },
  play: async ({ canvasElement }): Promise<void> => {
    const canvas = within(canvasElement);

    await userEvent.type(canvas.getByLabelText("Search members and invitations"), "Storybook");
    await expect(canvas.getByText("storybook@mistle.so")).toBeVisible();
    await expect(canvas.queryByText("product@mistle.so")).not.toBeInTheDocument();
  },
};
