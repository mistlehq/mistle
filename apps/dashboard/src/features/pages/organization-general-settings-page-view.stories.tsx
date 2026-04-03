import type { Meta, StoryObj } from "@storybook/react-vite";

import { withDashboardPageWidth } from "../../storybook/decorators.js";
import { OrganizationGeneralSettingsPageView } from "./organization-general-settings-page-view.js";

const meta = {
  title: "Dashboard/Pages/OrganizationGeneralSettingsPageView",
  component: OrganizationGeneralSettingsPageView,
  decorators: [withDashboardPageWidth],
  args: {
    isLoading: false,
    isSaving: false,
    loadErrorMessage: null,
    name: "Mistle Labs",
    onSaveChanges: async () => {},
    saveError: null,
  },
} satisfies Meta<typeof OrganizationGeneralSettingsPageView>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const Loading: Story = {
  args: {
    isLoading: true,
  },
};

export const LoadError: Story = {
  args: {
    loadErrorMessage: "Could not load organization settings.",
  },
};

export const Saving: Story = {
  args: {
    isSaving: true,
    name: "Mistle Storybook Labs",
  },
};

export const SaveError: Story = {
  args: {
    name: "Mistle Storybook Labs",
    saveError: "Could not update organization settings.",
  },
};
