import type { Meta, StoryObj } from "@storybook/react-vite";

import { InvitationAccessView } from "./invitation-access-view.js";

const meta = {
  title: "Dashboard/Onboarding/InvitationAccessView",
  component: InvitationAccessView,
  parameters: {
    layout: "fullscreen",
  },
  args: {
    invitedEmail: "dev@mistle.so",
    invitedBy: "owner@mistle.so",
    isAccepting: false,
    isDeclining: false,
    mutationError: null,
    onAccept: () => {},
    onDecline: () => {},
    organizationName: "Mistle Labs",
    role: "member",
  },
} satisfies Meta<typeof InvitationAccessView>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Ready: Story = {
  parameters: {
    docs: {
      description: {
        story:
          "Shown when the invitation loaded successfully and the user can still accept or decline it.",
      },
    },
  },
};

export const Accepting: Story = {
  args: {
    isAccepting: true,
  },
  parameters: {
    docs: {
      description: {
        story: "Shown while the accept action is in progress for a valid invitation.",
      },
    },
  },
};

export const Declining: Story = {
  args: {
    isDeclining: true,
  },
  parameters: {
    docs: {
      description: {
        story: "Shown while the decline action is in progress for a valid invitation.",
      },
    },
  },
};

export const AcceptFailed: Story = {
  args: {
    mutationError:
      "Unable to accept invitation. Please try again later or contact your administrator.",
  },
  parameters: {
    docs: {
      description: {
        story:
          "Shown when the invitation is still valid and visible, but accepting it failed and the user can try again.",
      },
    },
  },
};

export const DeclineFailed: Story = {
  args: {
    mutationError: "Unable to decline invitation.",
  },
  parameters: {
    docs: {
      description: {
        story:
          "Shown when the invitation is still valid and visible, but declining it failed and the user can try again.",
      },
    },
  },
};
