import type { Meta, StoryObj } from "@storybook/react-vite";

import {
  withDashboardCenteredSurface,
  withDashboardMemoryRouter,
} from "../../storybook/decorators.js";
import { AuthLoginCallbackPageView } from "./auth-login-callback-page-view.js";

const meta = {
  title: "Dashboard/Auth/AuthLoginCallbackPageView",
  component: AuthLoginCallbackPageView,
  decorators: [withDashboardMemoryRouter, withDashboardCenteredSurface],
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
