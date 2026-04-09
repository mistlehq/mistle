import { faker } from "@faker-js/faker";
import { Button } from "@mistle/ui";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { QueryClientProvider } from "@tanstack/react-query";
import { useState } from "react";
import type React from "react";
import { expect, userEvent, within } from "storybook/test";

import { withDashboardPageStory } from "../../storybook/decorators.js";
import { createTestQueryClient } from "../../test-support/query-client.js";
import type { SettingsInvitation, SettingsMember } from "../settings/members/members-api.js";
import type { RoleChangeDialogState } from "../settings/members/members-capability-policy.js";
import type { MembersDirectoryInvitationActionState } from "../settings/members/members-directory-model.js";
import { TableListingFooter } from "../shared/table-listing-footer.js";
import { TablePagination } from "../shared/table-pagination.js";
import { OrganizationMembersSettingsPageView } from "./organization-members-settings-page-view.js";
import {
  createOrganizationMembersSettingsPageStoryArgs,
  createOrganizationMembersStoryRoleChangeDialog,
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
  args: createOrganizationMembersSettingsPageStoryArgs(),
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
    roleChangeDialog: createOrganizationMembersStoryRoleChangeDialog("mem_storybook", "admin"),
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
        {...createOrganizationMembersSettingsPageStoryArgs({
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

    await userEvent.type(canvas.getByLabelText("Search members and invitations"), "Storybook");
    await expect(canvas.getByText("storybook@mistle.so")).toBeVisible();
    await expect(canvas.queryByText("product@mistle.so")).not.toBeInTheDocument();
  },
};

export const PaginationPreview: Story = {
  render: function RenderStory(): React.JSX.Element {
    return <PaginatedOrganizationMembersStory />;
  },
};

const PaginatedMembersStoryPageSize = 25;

function PaginatedOrganizationMembersStory(): React.JSX.Element {
  const [pageIndex, setPageIndex] = useState(0);
  const totalCount = PaginatedOrganizationMembersStoryEntries.length;
  const pageCount = Math.ceil(totalCount / PaginatedMembersStoryPageSize);
  const pageEntries = PaginatedOrganizationMembersStoryEntries.slice(
    pageIndex * PaginatedMembersStoryPageSize,
    (pageIndex + 1) * PaginatedMembersStoryPageSize,
  );

  const members: SettingsMember[] = [];
  const invitations: SettingsInvitation[] = [];
  for (const entry of pageEntries) {
    if (entry.kind === "member") {
      members.push(entry.value);
      continue;
    }

    invitations.push(entry.value);
  }

  return (
    <div className="flex flex-col gap-4">
      <OrganizationMembersSettingsPageView
        {...createOrganizationMembersSettingsPageStoryArgs({
          invitations,
          members,
        })}
      />
      <TableListingFooter
        pagination={
          <TablePagination
            hasNextPage={pageIndex < pageCount - 1}
            hasPreviousPage={pageIndex > 0}
            onNextPage={() => {
              setPageIndex((currentValue) => Math.min(currentValue + 1, pageCount - 1));
            }}
            onPreviousPage={() => {
              setPageIndex((currentValue) => Math.max(currentValue - 1, 0));
            }}
          />
        }
        resultsCount={
          <p className="text-muted-foreground text-sm">
            Showing {pageIndex * PaginatedMembersStoryPageSize + 1}-
            {Math.min((pageIndex + 1) * PaginatedMembersStoryPageSize, totalCount)} of {totalCount}
          </p>
        }
      />
    </div>
  );
}

const PaginatedOrganizationMembersStoryEntries = buildPaginatedOrganizationMembersStoryEntries();

function buildPaginatedOrganizationMembersStoryEntries(): Array<
  { kind: "member"; value: SettingsMember } | { kind: "invitation"; value: SettingsInvitation }
> {
  faker.seed(20260409);
  const entries: Array<
    { kind: "member"; value: SettingsMember } | { kind: "invitation"; value: SettingsInvitation }
  > = [];

  for (let index = 0; index < 40; index += 1) {
    const firstName = faker.person.firstName();
    const lastName = faker.person.lastName();
    const fullName = `${firstName} ${lastName}`;
    const email = faker.internet
      .email({
        firstName,
        lastName,
        provider: "mistle.so",
      })
      .toLowerCase();
    entries.push({
      kind: "member",
      value: {
        id: `mem_story_${index + 1}`,
        userId: `user_story_${index + 1}`,
        name: fullName,
        email,
        role: index % 5 === 0 ? "admin" : "member",
        joinedAt: buildStoryDateIso(index),
      },
    });
  }

  for (let index = 0; index < 12; index += 1) {
    const firstName = faker.person.firstName();
    const lastName = faker.person.lastName();
    const email = faker.internet
      .email({
        firstName,
        lastName,
        provider: "mistle.so",
      })
      .toLowerCase();
    entries.push({
      kind: "invitation",
      value: {
        id: `inv_story_${index + 1}`,
        organizationId: "org_storybook",
        email,
        role: index % 2 === 0 ? "member" : "admin",
        inviterId: index % 2 === 0 ? "user_product" : "user_owner",
        status: index % 3 === 0 ? "pending" : "revoked",
        rawStatus: null,
        expiresAt: `2026-05-${String(index + 10).padStart(2, "0")}T00:00:00.000Z`,
        createdAt: buildStoryDateIso(index + 1),
      },
    });
  }

  return entries.sort((left, right) => {
    const leftDate = left.kind === "member" ? left.value.joinedAt : left.value.createdAt;
    const rightDate = right.kind === "member" ? right.value.joinedAt : right.value.createdAt;
    return Date.parse(rightDate) - Date.parse(leftDate);
  });
}

function buildStoryDateIso(dayOffset: number): string {
  const day = 28 - dayOffset;
  return `2026-04-${String(day).padStart(2, "0")}T12:00:00.000Z`;
}
