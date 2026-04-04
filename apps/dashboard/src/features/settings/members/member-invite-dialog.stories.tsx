import type { Meta, StoryObj } from "@storybook/react-vite";

import { withDashboardCenteredStory } from "../../../storybook/decorators.js";
import { MemberInviteDialog } from "./member-invite-dialog.js";

const meta = {
  title: "Dashboard/Settings/OrganizationMembers/InviteDialog",
  component: MemberInviteDialog,
  decorators: [withDashboardCenteredStory],
  parameters: {
    layout: "fullscreen",
  },
  args: {
    assignableRoles: ["admin", "member"],
    canExecute: true,
    inviteMemberRequest: async () => ({
      status: "accepted",
      message: null,
      code: null,
      raw: null,
    }),
    onCompleted: async () => {},
    onOpenChange: () => {},
    open: true,
    organizationId: "org_storybook_001",
  },
} satisfies Meta<typeof MemberInviteDialog>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const InvitesDisabled: Story = {
  args: {
    canExecute: false,
  },
};
