import { Button } from "@mistle/ui";
import type { Meta, StoryObj } from "@storybook/react-vite";

import { StatusBox } from "../shared/status-box.js";
import { AuthStatusPage } from "./auth-status-page.js";

const meta = {
  title: "Dashboard/Auth/AuthStatusPage",
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
      <StatusBox tone="destructive">
        This invitation link is invalid or can no longer be used.
      </StatusBox>
    ),
  },
};

export const WithActions: Story = {
  args: {
    title: "Oops, something went wrong",
    align: "center",
    children: (
      <StatusBox tone="destructive">This invitation belongs to a different account.</StatusBox>
    ),
    actions: (
      <>
        <Button className="h-12 w-full text-sm" size="lg" type="button" variant="secondary">
          Sign out and use a different account
        </Button>
        <Button className="h-12 w-full text-sm" size="lg" type="button" variant="outline">
          Go to dashboard
        </Button>
      </>
    ),
  },
};
