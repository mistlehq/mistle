import { Badge, Button } from "@mistle/ui";
import type { Meta, StoryObj } from "@storybook/react-vite";

import { withDashboardPageWidth } from "../../storybook/decorators.js";
import { SettingsLayoutView } from "./settings-layout-view.js";

const meta = {
  title: "Dashboard/Settings/SettingsLayoutView",
  component: SettingsLayoutView,
  decorators: [withDashboardPageWidth],
  args: {
    children: (
      <div className="rounded-xl border bg-card p-6 shadow-xs">
        <p className="text-sm">Settings content renders here.</p>
      </div>
    ),
    description: "Manage account and organization settings.",
    headerActions: null,
    title: "Settings",
  },
} satisfies Meta<typeof SettingsLayoutView>;

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

export const WithoutDescription: Story = {
  args: {
    description: "",
    headerActions: (
      <Badge className="bg-emerald-600 text-white hover:bg-emerald-600/90" variant="secondary">
        Saved
      </Badge>
    ),
    title: "Profile",
  },
};
