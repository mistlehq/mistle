import type { Meta, StoryObj } from "@storybook/react-vite";

import { withDashboardMemoryRouter, withDashboardPageStory } from "../../storybook/decorators.js";
import { AuthLoginCallbackPageView } from "./auth-login-callback-page-view.js";

const meta = {
  title: "Dashboard/Auth/LoginCallbackPageView",
  component: AuthLoginCallbackPageView,
  decorators: [withDashboardPageStory, withDashboardMemoryRouter],
  parameters: {
    layout: "fullscreen",
  },
  args: {
    callbackError: null,
    isCompleting: true,
    onBackToLogin: () => {},
  },
} satisfies Meta<typeof AuthLoginCallbackPageView>;

export default meta;

type Story = StoryObj<typeof meta>;

export const CompletingSignIn: Story = {};

export const CallbackError: Story = {
  args: {
    callbackError: "Could not complete sign-in.",
    isCompleting: false,
  },
};
