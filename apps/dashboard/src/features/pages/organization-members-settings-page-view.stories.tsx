import type { Meta, StoryObj } from "@storybook/react-vite";
import { QueryClientProvider } from "@tanstack/react-query";
import { useState } from "react";
import type React from "react";
import { expect, userEvent, within } from "storybook/test";

import { withDashboardPageStory } from "../../storybook/decorators.js";
import { createTestQueryClient } from "../../test-support/query-client.js";
import type { RoleChangeDialogState } from "../settings/members/members-capability-policy.js";
import type { MembersDirectoryInvitationActionState } from "../settings/members/members-directory-model.js";
import { OrganizationMembersSettingsPageView } from "./organization-members-settings-page-view.js";
import {
  createOrganizationMembersStoryRoleChangeDialog,
  createOrganizationMembersSettingsPageStoryViewModel,
  OrganizationMembersStoryInvitations,
} from "./organization-members-settings-page-view.story-fixtures.js";

const meta = {
  title: "Dashboard/Settings/OrganizationMembers/PageView",
  component: OrganizationMembersSettingsPageView,
  decorators: [
    withDashboardPageStory,
    function QueryClientDecorator(Story): React.JSX.Element {
      const [queryClient] = useState(() =>
        createTestQueryClient({
          retry: false,
        }),
      );

      return (
        <QueryClientProvider client={queryClient}>
          <Story />
        </QueryClientProvider>
      );
    },
  ],
  args: {
    viewModel: createOrganizationMembersSettingsPageStoryViewModel(),
  },
} satisfies Meta<typeof OrganizationMembersSettingsPageView>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Loading: Story = {
  args: {
    viewModel: createOrganizationMembersSettingsPageStoryViewModel({
      isLoading: true,
    }),
  },
};

export const LoadError: Story = {
  args: {
    viewModel: createOrganizationMembersSettingsPageStoryViewModel({
      loadErrorMessage: "Failed to load members.",
    }),
  },
};

export const Default: Story = {};

export const Invited: Story = {
  args: {
    viewModel: createOrganizationMembersSettingsPageStoryViewModel({
      activeFilter: "invitations",
      invitations: OrganizationMembersStoryInvitations,
      members: [],
      total: OrganizationMembersStoryInvitations.length,
    }),
  },
};

export const CapabilitiesWarning: Story = {
  args: {
    viewModel: createOrganizationMembersSettingsPageStoryViewModel({
      capabilities: null,
      capabilitiesErrorMessage: "Membership permissions could not be loaded.",
    }),
  },
};

export const InviteDialogOpen: Story = {
  args: {
    viewModel: createOrganizationMembersSettingsPageStoryViewModel({
      inviteDialogOpen: true,
    }),
  },
};

export const RoleDialogOpen: Story = {
  args: {
    viewModel: createOrganizationMembersSettingsPageStoryViewModel({
      roleChangeDialog: createOrganizationMembersStoryRoleChangeDialog("mem_storybook", "admin"),
    }),
  },
};

export const PendingActions: Story = {
  args: {
    viewModel: createOrganizationMembersSettingsPageStoryViewModel({
      activeFilter: "invitations",
      invitationActionState: {
        invitationId: "inv_pending",
        action: "resend_invite",
        phase: "pending",
      },
      invitations: OrganizationMembersStoryInvitations,
      members: [],
      pendingMemberOperation: {
        kind: "change_role",
        memberId: "mem_storybook",
      },
    }),
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
        viewModel={createOrganizationMembersSettingsPageStoryViewModel({
          invitationActionState,
          inviteDialogOpen,
          onChangeRole: (member) => {
            setRoleChangeDialog({
              member,
              selectedRole: member.role === "member" ? "admin" : member.role,
              allowedRoles: ["admin", "member"],
            });
          },
          onInviteDialogOpenChange: setInviteDialogOpen,
          onResendInvite: (invitation) => {
            setInvitationActionState({
              invitationId: invitation.id,
              action: "resend_invite",
              phase: "completed",
            });
          },
          onRevokeInvite: (invitation) => {
            setInvitationActionState({
              invitationId: invitation.id,
              action: "revoke_invitation",
              phase: "completed",
            });
          },
          onRoleDialogCancel: () => {
            setRoleChangeDialog(null);
          },
          onRoleDialogOpenChange: (nextOpen) => {
            if (!nextOpen) {
              setRoleChangeDialog(null);
            }
          },
          onSaveRole: () => {
            setRoleChangeDialog(null);
          },
          roleChangeDialog,
        })}
      />
    );
  },
  play: async ({ canvasElement }): Promise<void> => {
    const canvas = within(canvasElement);

    await userEvent.type(canvas.getByLabelText("Search"), "Storybook");
    await expect(canvas.getByText("storybook@mistle.so")).toBeVisible();
    await expect(canvas.queryByText("product@mistle.so")).not.toBeInTheDocument();
  },
};
