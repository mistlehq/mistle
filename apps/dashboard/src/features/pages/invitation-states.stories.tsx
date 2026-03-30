import { Button } from "@mistle/ui";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, within } from "storybook/test";

import { AuthStatusPage } from "../auth/auth-status-page.js";
import { StatusBox } from "../shared/status-box.js";
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
      <StatusBox tone="destructive">
        This invitation link is invalid or can no longer be used.
      </StatusBox>
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
    children: (
      <StatusBox tone="destructive">This invitation belongs to a different account.</StatusBox>
    ),
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
    children: <StatusBox tone="destructive">Please try again later.</StatusBox>,
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
      <StatusBox tone="neutral">
        <p className="text-center">You now have access to Mistle Labs.</p>
      </StatusBox>
    ),
    actions: (
      <Button className="h-12 w-full text-sm" size="lg" type="button">
        Continue
      </Button>
    ),
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
      <StatusBox tone="neutral">
        <p className="text-center">You declined this invitation.</p>
      </StatusBox>
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
