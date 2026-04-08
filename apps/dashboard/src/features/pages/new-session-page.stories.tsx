import type { Meta, StoryObj } from "@storybook/react-vite";

import { withDashboardPageStory } from "../../storybook/decorators.js";
import type { LaunchableSandboxProfilesResult } from "../sandbox-profiles/sandbox-profiles-types.js";
import { buildStoryLaunchableSandboxProfile } from "./sessions-page.story-fixtures.js";
import { SessionsStoryHarness } from "./sessions-story-harness.js";

type NewSessionPageStoryArgs = {
  launchableProfiles?: LaunchableSandboxProfilesResult["items"];
};

function NewSessionPageStory(input: NewSessionPageStoryArgs): React.JSX.Element {
  return (
    <SessionsStoryHarness
      initialEntries={["/sessions/new"]}
      launchableProfiles={input.launchableProfiles}
    />
  );
}

const meta = {
  title: "Dashboard/Sessions/NewPage",
  component: NewSessionPageStory,
  tags: ["autodocs"],
  decorators: [withDashboardPageStory],
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
