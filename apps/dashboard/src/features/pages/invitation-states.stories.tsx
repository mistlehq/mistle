import { Notice, ScreenActionButton } from "@mistle/ui";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, within } from "storybook/test";

import { AuthStatusPage } from "../auth/auth-status-page.js";
import { InvitationLoadingState } from "./invitation-loading-state.js";

const meta = {
  title: "Dashboard/Onboarding/InvitationStates",
  component: AuthStatusPage,
  parameters: {
    layout: "fullscreen",
  },
} satisfies Meta<typeof AuthStatusPage>;

export default meta;

type Story = StoryObj<typeof meta>;

export const LinkInvalid: Story = {
  args: {
    align: "center",
    title: "Oops, something went wrong",
    children: (
      <Notice variant="alert">This invitation link is invalid or can no longer be used.</Notice>
    ),
  },
  parameters: {
    docs: {
      description: {
        story:
          "Shown when the invitation link is malformed, expired, revoked, or otherwise no longer usable. No invitation details or actions are shown.",
      },
    },
  },
  play: async ({ canvasElement }): Promise<void> => {
    const canvas = within(canvasElement);
    await expect(
      canvas.queryByRole("button", { name: "Accept invitation" }),
    ).not.toBeInTheDocument();
    await expect(canvas.queryByRole("button", { name: "Decline" })).not.toBeInTheDocument();
  },
};

export const Loading: Story = {
  render: () => <InvitationLoadingState />,
  parameters: {
    docs: {
      description: {
        story:
          "Shown while the invitation route is resolving session or invitation details before a terminal or actionable state can be rendered.",
      },
    },
  },
};

export const WrongAccountSignedIn: Story = {
  args: {
    align: "center",
    title: "Oops, something went wrong",
    children: <Notice variant="alert">This invitation belongs to a different account.</Notice>,
  },
  parameters: {
    docs: {
      description: {
        story:
          "Shown when the invitation belongs to a different account than the one currently signed in.",
      },
    },
  },
};

export const SessionCheckFailed: Story = {
  args: {
    align: "center",
    title: "Oops, something went wrong",
    children: <Notice variant="alert">Please try again later.</Notice>,
  },
  parameters: {
    docs: {
      description: {
        story:
          "Shown when the invitation flow hits a generic failure and no specific recovery step is available.",
      },
    },
  },
};

export const InvitationAccepted: Story = {
  args: {
    align: "center",
    title: "Invitation accepted",
    children: (
      <Notice>
        <p className="text-center">You now have access to Mistle Labs.</p>
      </Notice>
    ),
    actions: <ScreenActionButton type="button">Continue</ScreenActionButton>,
  },
  parameters: {
    docs: {
      description: {
        story: "Terminal success state shown after the user accepts the invitation.",
      },
    },
  },
};

export const InvitationDeclined: Story = {
  args: {
    align: "center",
    title: "Invitation declined",
    children: (
      <Notice>
        <p className="text-center">You declined this invitation.</p>
      </Notice>
    ),
  },
  parameters: {
    docs: {
      description: {
        story: "Terminal state shown after the user declines the invitation.",
      },
    },
  },
};
