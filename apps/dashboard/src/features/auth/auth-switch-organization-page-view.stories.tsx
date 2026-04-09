import type { Meta, StoryObj } from "@storybook/react-vite";

import { withDashboardMemoryRouter, withDashboardPageStory } from "../../storybook/decorators.js";
import { AuthSwitchOrganizationPageView } from "./auth-switch-organization-page-view.js";

const meta = {
  title: "Dashboard/Auth/SwitchOrganizationPageView",
  component: AuthSwitchOrganizationPageView,
  decorators: [withDashboardPageStory, withDashboardMemoryRouter],
  parameters: {
    layout: "fullscreen",
  },
} satisfies Meta<typeof AuthSwitchOrganizationPageView>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {};
