import type { Meta, StoryObj } from "@storybook/react-vite";
import { QueryClientProvider } from "@tanstack/react-query";
import { useState } from "react";

import {
  createDashboardMemoryRouterDecorator,
  withDashboardPageStory,
} from "../../storybook/decorators.js";
import type { LaunchableSandboxProfilesResult } from "../sandbox-profiles/sandbox-profiles-types.js";
import { NewSessionPage } from "./new-session-page.js";
import {
  buildStoryLaunchableSandboxProfile,
  createSessionsPageStoryQueryClient,
} from "./sessions-page.story-fixtures.js";

type NewSessionPageStoryArgs = {
  launchableProfiles?: LaunchableSandboxProfilesResult["items"];
};

function NewSessionPageStory(input: NewSessionPageStoryArgs): React.JSX.Element {
  const [queryClient] = useState(() =>
    createSessionsPageStoryQueryClient({
      ...(input.launchableProfiles !== undefined
        ? { launchableProfiles: input.launchableProfiles }
        : {}),
    }),
  );

  return (
    <QueryClientProvider client={queryClient}>
      <NewSessionPage />
    </QueryClientProvider>
  );
}

const meta = {
  title: "Dashboard/Sessions/NewPage",
  component: NewSessionPageStory,
  tags: ["autodocs"],
  decorators: [withDashboardPageStory, createDashboardMemoryRouterDecorator(["/sessions/new"])],
  parameters: {
    layout: "fullscreen",
  },
  args: {
    launchableProfiles: [
      buildStoryLaunchableSandboxProfile({
        id: "sbp_profile_alpha",
        displayName: "Alpha Profile",
      }),
      buildStoryLaunchableSandboxProfile({
        id: "sbp_profile_beta",
        displayName: "Beta Profile",
        latestVersion: 7,
      }),
    ],
  },
  render: function RenderStory(args): React.JSX.Element {
    return <NewSessionPageStory {...args} />;
  },
} satisfies Meta<typeof NewSessionPageStory>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const NoLaunchableProfiles: Story = {
  args: {
    launchableProfiles: [],
  },
};
