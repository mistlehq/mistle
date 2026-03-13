import { Button } from "@mistle/ui";
import type { Meta, StoryObj } from "@storybook/react-vite";

import { withDashboardPageWidth } from "../../storybook/decorators.js";
import { SettingsPageHeader } from "./settings-page-header.js";

const meta = {
  title: "Dashboard/Settings/SettingsPageHeader",
  component: SettingsPageHeader,
  decorators: [withDashboardPageWidth],
  args: {
    headerActions: null,
    supportingText: "",
    title: "Settings",
  },
} satisfies Meta<typeof SettingsPageHeader>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const WithActions: Story = {
  args: {
    headerActions: (
      <Button size="sm" type="button">
        Invite members
      </Button>
    ),
    title: "Members",
  },
};

export const IntegrationDetailHeader: Story = {
  args: {
    headerIcon: (
      <div className="flex h-11 w-11 items-center justify-center rounded-md border bg-muted text-sm font-semibold">
        GH
      </div>
    ),
    supportingText: "github-cloud",
    title: "GitHub",
  },
};
