import type { Meta, StoryObj } from "@storybook/react-vite";

import { withDashboardPageStory } from "../../storybook/decorators.js";
import { OrganizationUsageSettingsPageView } from "./organization-usage-settings-page-view.js";
import {
  createOrganizationUsageEmptyMeasuredProps,
  createOrganizationUsagePartialMeasurementProps,
  createOrganizationUsagePrototypeProps,
} from "./organization-usage-settings-page-view.story-fixtures.js";

const calendarMonthProps = createOrganizationUsagePrototypeProps();

const meta = {
  title: "Dashboard/Settings/OrganizationUsage/PageView",
  component: OrganizationUsageSettingsPageView,
  decorators: [withDashboardPageStory],
  args: calendarMonthProps,
} satisfies Meta<typeof OrganizationUsageSettingsPageView>;

export default meta;

type Story = StoryObj<typeof meta>;

export const CalendarMonth: Story = {};

export const PartialMeasurement: Story = {
  args: createOrganizationUsagePartialMeasurementProps(),
};

export const NoMeasuredUsage: Story = {
  args: createOrganizationUsageEmptyMeasuredProps(),
};
