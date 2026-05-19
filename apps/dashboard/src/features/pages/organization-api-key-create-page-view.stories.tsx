import type { Meta, StoryObj } from "@storybook/react-vite";

import { withDashboardPageStory } from "../../storybook/decorators.js";
import { OrganizationApiKeyCreatePageView } from "./organization-api-key-create-page-view.js";

const meta = {
  title: "Dashboard/Settings/OrganizationApiKeys/CreatePageView",
  component: OrganizationApiKeyCreatePageView,
  decorators: [withDashboardPageStory],
  args: {
    createErrorMessage: null,
    isCreating: false,
    onCreateApiKey: () => {},
  },
} satisfies Meta<typeof OrganizationApiKeyCreatePageView>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const Creating: Story = {
  args: {
    isCreating: true,
  },
};

export const CreateError: Story = {
  args: {
    createErrorMessage: "Could not create API key.",
  },
};
