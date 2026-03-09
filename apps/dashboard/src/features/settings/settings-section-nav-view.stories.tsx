import type { Meta, StoryObj } from "@storybook/react-vite";

import {
  createDashboardMemoryRouterDecorator,
  withDashboardPageWidth,
} from "../../storybook/decorators.js";
import { SettingsSectionNavView } from "./settings-section-nav-view.js";
import { SettingsStoryPathnames } from "./settings-story-fixtures.js";

const meta = {
  title: "Dashboard/Settings/SettingsSectionNavView",
  component: SettingsSectionNavView,
  decorators: [
    withDashboardPageWidth,
    createDashboardMemoryRouterDecorator(),
    function WithStoryContainer(Story): React.JSX.Element {
      return (
        <div className="max-w-xs">
          <Story />
        </div>
      );
    },
  ],
  args: {
    pathname: SettingsStoryPathnames.ACCOUNT_PROFILE,
  },
} satisfies Meta<typeof SettingsSectionNavView>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Profile: Story = {};

export const General: Story = {
  args: {
    pathname: SettingsStoryPathnames.ORGANIZATION_GENERAL,
  },
};

export const Members: Story = {
  args: {
    pathname: SettingsStoryPathnames.ORGANIZATION_MEMBERS,
  },
};

export const Integrations: Story = {
  args: {
    pathname: SettingsStoryPathnames.ORGANIZATION_INTEGRATIONS,
  },
};
