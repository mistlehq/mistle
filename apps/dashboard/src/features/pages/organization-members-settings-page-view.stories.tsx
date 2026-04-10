import type { Meta, StoryObj } from "@storybook/react-vite";
import { QueryClientProvider } from "@tanstack/react-query";
import { useState } from "react";
import type React from "react";
import { expect, userEvent, within } from "storybook/test";

import { withDashboardPageStory } from "../../storybook/decorators.js";
import { createTestQueryClient } from "../../test-support/query-client.js";
import type { RoleChangeDialogState } from "../settings/members/members-capability-policy.js";
import type { MembersDirectoryInvitationActionState } from "../settings/members/members-directory-model.js";
import type { OrganizationMembersSettingsPageViewModel } from "../settings/members/organization-members-settings-view-model.js";
import { OrganizationMembersSettingsPageView } from "./organization-members-settings-page-view.js";
import {
  createOrganizationMembersStoryRoleChangeDialog,
  createOrganizationMembersSettingsPageStoryRoleViewModel,
  OrganizationMembersStoryInvitations,
  OrganizationMembersStoryMembers,
  type OrganizationMembersStoryViewerRole,
} from "./organization-members-settings-page-view.story-fixtures.js";

type OrganizationMembersSettingsPageStoryProps = {
  viewerRole: OrganizationMembersStoryViewerRole;
  viewModelOverrides?: Partial<OrganizationMembersSettingsPageViewModel>;
};

function OrganizationMembersSettingsPageStory(
  input: OrganizationMembersSettingsPageStoryProps,
): React.JSX.Element {
  return (
    <OrganizationMembersSettingsPageView
      viewModel={createOrganizationMembersSettingsPageStoryRoleViewModel(
        input.viewModelOverrides === undefined
          ? {
              viewerRole: input.viewerRole,
            }
          : {
              viewerRole: input.viewerRole,
              overrides: input.viewModelOverrides,
            },
      )}
    />
  );
}

const meta = {
  title: "Dashboard/Settings/OrganizationMembers/PageView",
  component: OrganizationMembersSettingsPageStory,
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
  argTypes: {
    viewerRole: {
      control: "inline-radio",
      options: ["owner", "admin", "member"],
    },
    viewModelOverrides: {
      control: false,
    },
  },
  args: {
    viewerRole: "admin",
    viewModelOverrides: {},
  },
} satisfies Meta<typeof OrganizationMembersSettingsPageStory>;

export default meta;

type Story = StoryObj<typeof meta>;

function filterStoryMembers(searchValue: string) {
  const normalizedSearch = searchValue.trim().toLowerCase();
  if (normalizedSearch.length === 0) {
    return OrganizationMembersStoryMembers;
  }

  return OrganizationMembersStoryMembers.filter((member) => {
    return (
      member.name.toLowerCase().includes(normalizedSearch) ||
      member.email.toLowerCase().includes(normalizedSearch) ||
      member.role.toLowerCase().includes(normalizedSearch)
    );
  });
}

function filterStoryInvitations(searchValue: string) {
  const normalizedSearch = searchValue.trim().toLowerCase();
  if (normalizedSearch.length === 0) {
    return OrganizationMembersStoryInvitations;
  }

  return OrganizationMembersStoryInvitations.filter((invitation) => {
    return (
      invitation.email.toLowerCase().includes(normalizedSearch) ||
      invitation.role.toLowerCase().includes(normalizedSearch) ||
      invitation.status.toLowerCase().includes(normalizedSearch) ||
      invitation.inviterName.toLowerCase().includes(normalizedSearch)
    );
  });
}

function renderInteractiveStory(
  args: OrganizationMembersSettingsPageStoryProps,
): React.JSX.Element {
  const [activeFilter, setActiveFilter] = useState<"members" | "invitations">(
    args.viewModelOverrides?.activeFilter ?? "members",
  );
  const [searchValue, setSearchValue] = useState(args.viewModelOverrides?.searchValue ?? "");
  const [inviteDialogOpen, setInviteDialogOpen] = useState(
    args.viewModelOverrides?.inviteDialogOpen ?? false,
  );
  const [roleChangeDialog, setRoleChangeDialog] = useState<RoleChangeDialogState | null>(
    args.viewModelOverrides?.roleChangeDialog ?? null,
  );
  const [invitationActionState, setInvitationActionState] =
    useState<MembersDirectoryInvitationActionState>(
      args.viewModelOverrides?.invitationActionState ?? null,
    );

  const filteredMembers = filterStoryMembers(searchValue);
  const filteredInvitations = filterStoryInvitations(searchValue);
  const visibleMembers = activeFilter === "members" ? filteredMembers : [];
  const visibleInvitations = activeFilter === "invitations" ? filteredInvitations : [];
  const total = activeFilter === "members" ? filteredMembers.length : filteredInvitations.length;

  return (
    <OrganizationMembersSettingsPageView
      viewModel={createOrganizationMembersSettingsPageStoryRoleViewModel({
        viewerRole: args.viewerRole,
        overrides: {
          ...args.viewModelOverrides,
          activeFilter,
          invitations: visibleInvitations,
          invitationActionState,
          inviteDialogOpen,
          members: visibleMembers,
          onChangeRole: (member) => {
            setRoleChangeDialog({
              member,
              selectedRole: member.role === "member" ? "admin" : member.role,
              allowedRoles: ["admin", "member"],
            });
          },
          onFilterChange: setActiveFilter,
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
          onSearchValueChange: setSearchValue,
          roleChangeDialog,
          searchValue,
          total,
        },
      })}
    />
  );
}

export const Loading: Story = {
  args: {
    viewModelOverrides: {
      isLoading: true,
    },
  },
};

export const LoadError: Story = {
  args: {
    viewModelOverrides: {
      loadErrorMessage: "Failed to load members.",
    },
  },
};

export const Default: Story = {
  render: renderInteractiveStory,
};

export const CapabilitiesWarning: Story = {
  args: {
    viewModelOverrides: {
      capabilities: null,
      capabilitiesErrorMessage: "Membership permissions could not be loaded.",
    },
  },
};

export const InviteDialogOpen: Story = {
  args: {
    viewModelOverrides: {
      inviteDialogOpen: true,
    },
  },
};

export const RoleDialogOpen: Story = {
  args: {
    viewModelOverrides: {
      roleChangeDialog: createOrganizationMembersStoryRoleChangeDialog("mem_storybook", "admin"),
    },
  },
};

export const PendingActions: Story = {
  args: {
    viewModelOverrides: {
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
    },
  },
};

export const InteractiveFiltering: Story = {
  render: renderInteractiveStory,
  play: async ({ canvasElement }): Promise<void> => {
    const canvas = within(canvasElement);

    await userEvent.type(canvas.getByLabelText("Search"), "Storybook");
    await expect(canvas.getByText("storybook@mistle.so")).toBeVisible();
    await expect(canvas.queryByText("product@mistle.so")).not.toBeInTheDocument();
  },
};
