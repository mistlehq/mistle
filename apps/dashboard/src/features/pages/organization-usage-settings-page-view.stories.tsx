import type { Meta, StoryObj } from "@storybook/react-vite";

import { withDashboardPageStory } from "../../storybook/decorators.js";
import { OrganizationUsageSettingsPageView } from "./organization-usage-settings-page-view.js";
import { createOrganizationUsagePrototypeProps } from "./organization-usage-settings-page-view.story-fixtures.js";

const calendarMonthProps = createOrganizationUsagePrototypeProps();

/**
 * Prototype the organization usage dashboard before the aggregate usage API exists. Review the
 * story for metric hierarchy, period framing, and whether factual drilldown tables explain which
 * profiles and activities drive sandbox consumption.
 */
const meta = {
  title: "Dashboard/Settings/OrganizationUsage/PageView",
  component: OrganizationUsageSettingsPageView,
  decorators: [withDashboardPageStory],
  args: calendarMonthProps,
} satisfies Meta<typeof OrganizationUsageSettingsPageView>;

export default meta;

type Story = StoryObj<typeof meta>;

export const CalendarMonth: Story = {};
