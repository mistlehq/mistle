import { Notice, ScreenActionButton } from "@mistle/ui";
import type { Meta, StoryObj } from "@storybook/react-vite";

import { AuthStatusPage } from "./auth-status-page.js";

const meta = {
  title: "Dashboard/Auth/StatusPage",
  component: AuthStatusPage,
  parameters: {
    layout: "fullscreen",
  },
} satisfies Meta<typeof AuthStatusPage>;

export default meta;

type Story = StoryObj<typeof meta>;

export const PlainError: Story = {
  args: {
    title: "Oops, something went wrong",
    align: "center",
    children: (
      <Notice variant="alert">This invitation link is invalid or can no longer be used.</Notice>
    ),
  },
};

export const WithActions: Story = {
  args: {
    title: "Oops, something went wrong",
    align: "center",
    children: <Notice variant="alert">This invitation belongs to a different account.</Notice>,
    actions: (
      <>
        <ScreenActionButton type="button" variant="secondary">
          Sign out and use a different account
        </ScreenActionButton>
        <ScreenActionButton type="button" variant="outline">
          Go to dashboard
        </ScreenActionButton>
      </>
    ),
  },
};
