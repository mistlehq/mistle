import type { Meta, StoryObj } from "@storybook/react-vite";

import { withDashboardPageStory } from "../../storybook/decorators.js";
import { OrganizationBillingSettingsPageView } from "./organization-billing-settings-page-view.js";

const meta = {
  title: "Dashboard/Settings/OrganizationBilling/PageView",
  component: OrganizationBillingSettingsPageView,
  decorators: [withDashboardPageStory],
  args: {
    billing: {
      available: true,
      organization: {
        name: "Mistle Labs",
        stripeCustomerId: "cus_S8WmYh2jWbLk9p",
      },
    },
    loadErrorMessage: null,
  },
} satisfies Meta<typeof OrganizationBillingSettingsPageView>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Available: Story = {};

export const NotAvailableYet: Story = {
  args: {
    billing: {
      available: false,
    },
  },
};

export const LoadError: Story = {
  args: {
    billing: {
      available: false,
    },
    loadErrorMessage: "Could not load billing information.",
  },
};
