import type { Meta, StoryObj } from "@storybook/react-vite";
import { MemoryRouter } from "react-router";

import { withDashboardPageWidth } from "../../storybook/decorators.js";
import { SettingsSectionNavView } from "./settings-section-nav-view.js";

const meta = {
  title: "Dashboard/Settings/SettingsSectionNavView",
  component: SettingsSectionNavView,
  decorators: [
    withDashboardPageWidth,
    function MemoryRouterDecorator(Story): React.JSX.Element {
      return (
        <MemoryRouter>
          <div className="max-w-xs">
            <Story />
          </div>
        </MemoryRouter>
      );
    },
  ],
  args: {
    pathname: "/settings/account/profile",
  },
} satisfies Meta<typeof SettingsSectionNavView>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Profile: Story = {};

export const General: Story = {
  args: {
    pathname: "/settings/organization/general",
  },
};

export const Members: Story = {
  args: {
    pathname: "/settings/organization/members",
  },
};

export const Integrations: Story = {
  args: {
    pathname: "/settings/organization/integrations",
  },
};
