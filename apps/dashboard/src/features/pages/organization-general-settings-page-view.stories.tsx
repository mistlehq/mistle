import type { Meta, StoryObj } from "@storybook/react-vite";

import { withDashboardPageStory } from "../../storybook/decorators.js";
import { OrganizationGeneralSettingsPageView } from "./organization-general-settings-page-view.js";

const meta = {
  title: "Dashboard/Settings/OrganizationGeneral/PageView",
  component: OrganizationGeneralSettingsPageView,
  decorators: [withDashboardPageStory],
  args: {
    isLoading: false,
    isSaving: false,
    loadErrorMessage: null,
    logoBusy: false,
    logoErrorMessage: null,
    logoUrl: null,
    name: "Mistle Labs",
    onDeleteLogo: async () => {},
    onSaveChanges: async () => {},
    onUploadLogo: async () => {},
  },
} satisfies Meta<typeof OrganizationGeneralSettingsPageView>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const WithLogo: Story = {
  args: {
    logoUrl: "https://images.example.com/mistle-logo.webp",
  },
};

export const LogoBusy: Story = {
  args: {
    logoBusy: true,
  },
};

export const LogoError: Story = {
  args: {
    logoErrorMessage: "Could not upload organization logo.",
  },
};

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
