import { Button } from "@mistle/ui";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import type React from "react";
import { expect, userEvent, within } from "storybook/test";

import { withDashboardPageWidth } from "../../storybook/decorators.js";
import type { RoleChangeDialogState } from "../settings/members/members-capability-policy.js";
import type { MembersDirectoryInvitationActionState } from "../settings/members/members-directory-model.js";
import { OrganizationMembersSettingsPageView } from "./organization-members-settings-page-view.js";
import {
  createOrganizationMembersSettingsPageStoryArgs,
  createOrganizationMembersStoryRoleChangeDialog,
  inviteOrganizationMemberStoryRequest,
  OrganizationMembersStoryInvitations,
  OrganizationMembersStoryMembers,
} from "./organization-members-settings-page-view.story-fixtures.js";

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

export const InteractiveDialogsAndRecovery: Story = {
  render: function RenderStory(): React.JSX.Element {
    const [isLoaded, setIsLoaded] = useState(false);
    const [capabilitiesErrorMessage, setCapabilitiesErrorMessage] = useState<string | null>(null);
    const [inviteDialogOpen, setInviteDialogOpen] = useState(false);
    const [roleChangeDialog, setRoleChangeDialog] = useState<RoleChangeDialogState | null>(null);
    const [invitationActionState, setInvitationActionState] =
      useState<MembersDirectoryInvitationActionState>(null);
    const [lastAction, setLastAction] = useState("Waiting for interaction.");

    return (
      <div className="flex flex-col gap-4">
        <p aria-live="polite" role="status">
          {lastAction}
        </p>
        <OrganizationMembersSettingsPageView
          {...createOrganizationMembersSettingsPageStoryArgs({
            capabilitiesErrorMessage,
            invitationActionState,
            invitations: OrganizationMembersStoryInvitations,
            inviteDialogOpen,
            inviteMemberRequest: inviteOrganizationMemberStoryRequest,
            isLoading: !isLoaded,
            loadErrorMessage: isLoaded ? null : "Failed to load members.",
            members: OrganizationMembersStoryMembers,
            onChangeRole: (member) => {
              setRoleChangeDialog({
                member,
                selectedRole: "admin",
                allowedRoles: ["admin", "member"],
              });
              setLastAction(`Opened role dialog for ${member.name}.`);
            },
            onInviteCompleted: async () => {
              setLastAction("Invite flow completed.");
            },
            onInviteDialogOpenChange: (nextOpen) => {
              setInviteDialogOpen(nextOpen);
              setLastAction(nextOpen ? "Invite dialog opened." : "Invite dialog closed.");
            },
            onResendInvite: (invitation) => {
              setInvitationActionState({
                invitationId: invitation.id,
                action: "resend_invite",
                phase: "completed",
              });
              setLastAction(`Invitation resent to ${invitation.email}.`);
            },
            onRetryCapabilities: () => {
              setCapabilitiesErrorMessage(null);
              setLastAction("Capabilities loaded.");
            },
            onRetryLoad: () => {
              setIsLoaded(true);
              setCapabilitiesErrorMessage("Membership permissions could not be loaded.");
              setLastAction("Members loaded.");
            },
            onRoleDialogCancel: () => {
              setRoleChangeDialog(null);
              setLastAction("Role dialog cancelled.");
            },
            onRoleDialogOpenChange: (nextOpen) => {
              if (!nextOpen) {
                setRoleChangeDialog(null);
              }
            },
            onSaveRole: () => {
              if (roleChangeDialog === null) {
                throw new Error("Missing role change dialog state.");
              }

              setRoleChangeDialog(null);
              setLastAction(`Saved role for ${roleChangeDialog.member.name}.`);
            },
            roleChangeDialog,
          })}
        />
      </div>
    );
  },
  play: async ({ canvasElement }): Promise<void> => {
    const body = within(canvasElement.ownerDocument.body);

    await expect(body.getByText("Failed to load members.")).toBeVisible();
    await userEvent.click(body.getByRole("button", { name: "Retry" }));
    await expect(body.getByRole("status")).toHaveTextContent("Members loaded.");
    await expect(
      body.getByText("Membership permissions could not be loaded. Try again."),
    ).toBeVisible();

    await userEvent.click(body.getByRole("button", { name: "Retry" }));
    await expect(body.getByRole("status")).toHaveTextContent("Capabilities loaded.");
    await expect(
      body.queryByText("Membership permissions could not be loaded. Try again."),
    ).not.toBeInTheDocument();

    await userEvent.click(body.getByRole("button", { name: "Invite members" }));
    await expect(body.getByRole("heading", { name: "Invite members" })).toBeVisible();
    await expect(body.getByRole("status")).toHaveTextContent("Invite dialog opened.");
    await userEvent.click(body.getByRole("button", { name: "Cancel" }));
    await expect(body.getByRole("status")).toHaveTextContent("Invite dialog closed.");

    await userEvent.click(body.getByLabelText("Member actions"));
    await userEvent.click(await body.findByText("Change role"));
    await expect(body.getByRole("heading", { name: "Change role" })).toBeVisible();
    await expect(body.getByRole("status")).toHaveTextContent(
      "Opened role dialog for Mistle Owner.",
    );
    await userEvent.click(body.getByRole("button", { name: "Save role" }));
    await expect(body.getByRole("status")).toHaveTextContent("Saved role for Mistle Owner.");

    await userEvent.click(body.getByLabelText("Invitation actions"));
    await userEvent.click(await body.findByText("Resend invite"));
    await expect(body.getByRole("status")).toHaveTextContent(
      "Invitation resent to pending@mistle.so.",
    );
    await expect(body.getByText("Sent")).toBeVisible();
  },
};
