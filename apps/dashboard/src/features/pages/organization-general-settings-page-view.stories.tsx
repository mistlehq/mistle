import type { Meta, StoryObj } from "@storybook/react-vite";

import { withDashboardPageWidth } from "../../storybook/decorators.js";
import { OrganizationGeneralSettingsPageView } from "./organization-general-settings-page-view.js";

const meta = {
  title: "Dashboard/Pages/OrganizationGeneralSettingsPageView",
  component: OrganizationGeneralSettingsPageView,
  decorators: [withDashboardPageWidth],
  args: {
    hasDirtyChanges: false,
    isLoading: false,
    isSaving: false,
    loadErrorMessage: null,
    name: "Mistle Labs",
    nameErrorMessage: null,
    onCancelChanges: () => {},
    onNameChange: () => {},
    onSaveChanges: () => {},
    saveErrorMessage: null,
    saveSuccess: false,
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

export const DirtyChanges: Story = {
  args: {
    hasDirtyChanges: true,
    name: "Mistle Storybook Labs",
  },
};

export const ValidationError: Story = {
  args: {
    hasDirtyChanges: true,
    name: "",
    nameErrorMessage: "Organization name is required.",
  },
};

export const Saving: Story = {
  args: {
    hasDirtyChanges: true,
    isSaving: true,
    name: "Mistle Storybook Labs",
  },
};

export const SaveError: Story = {
  args: {
    hasDirtyChanges: true,
    name: "Mistle Storybook Labs",
    saveErrorMessage: "Could not update organization settings.",
  },
};

export const Saved: Story = {
  args: {
    saveSuccess: true,
  },
};
