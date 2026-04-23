import type { Meta, StoryObj } from "@storybook/react-vite";

import { withDashboardPageStory } from "../../storybook/decorators.js";
import {
  SandboxProfileSetupPageViewStory,
  type SandboxProfileSetupPageViewStoryProps,
} from "./sandbox-profile-setup-prototype.stories.js";

/**
 * Empty baseline for the sandbox profile setup page when the organization has
 * not connected any integrations yet.
 */
const meta = {
  title: "Dashboard/SandboxProfiles/SetupFlow/EmptyPageView",
  component: SandboxProfileSetupPageViewStory,
  decorators: [withDashboardPageStory],
} satisfies Meta<typeof SandboxProfileSetupPageViewStory>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: {
    initialRows: [],
    availableConnections: [],
    availableTargets: [],
  } satisfies SandboxProfileSetupPageViewStoryProps,
};
