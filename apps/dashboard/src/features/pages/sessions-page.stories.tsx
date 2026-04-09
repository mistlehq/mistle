import type { Meta, StoryObj } from "@storybook/react-vite";

import { withDashboardPageStory } from "../../storybook/decorators.js";
import type { LaunchableSandboxProfilesResult } from "../sandbox-profiles/sandbox-profiles-types.js";
import type { SandboxInstancesListResult } from "../sessions/sessions-types.js";
import {
  buildSandboxInstanceListItemFixture,
  buildStoryLaunchableSandboxProfile,
} from "./sessions-page.story-fixtures.js";
import { SessionsStoryHarness } from "./sessions-story-harness.js";

type SessionsPageStoryArgs = {
  launchableProfiles?: LaunchableSandboxProfilesResult["items"];
  sandboxInstancesList?: SandboxInstancesListResult;
};

function SessionsPageStory(input: SessionsPageStoryArgs): React.JSX.Element {
  return (
    <SessionsStoryHarness
      initialEntries={["/sessions"]}
      launchableProfiles={input.launchableProfiles}
      sandboxInstancesList={input.sandboxInstancesList}
    />
  );
}

const meta = {
  title: "Dashboard/Sessions/Page",
  component: SessionsPageStory,
  tags: ["autodocs"],
  parameters: {
    layout: "fullscreen",
  },
  decorators: [withDashboardPageStory],
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
    sandboxInstancesList: {
      items: [
        buildSandboxInstanceListItemFixture({
          id: "sbi_running",
          title: "Investigate flaky test run",
          sandboxProfileDisplayName: "Repo Maintainer",
          status: "running",
          createdAt: "2026-04-01T09:00:00.000Z",
        }),
        buildSandboxInstanceListItemFixture({
          id: "sbi_starting",
          title: "Reconcile Q2 variance report",
          sandboxProfileDisplayName: "Finance Investigator",
          status: "starting",
          createdAt: "2026-04-01T08:55:00.000Z",
        }),
        buildSandboxInstanceListItemFixture({
          id: "sbi_stopped",
          title: "Draft migration guide",
          sandboxProfileDisplayName: "Docs Maintainer",
          status: "stopped",
          createdAt: "2026-03-31T15:30:00.000Z",
        }),
        buildSandboxInstanceListItemFixture({
          id: "sbi_failed",
          title: null,
          sandboxProfileDisplayName: "Webhook Debugger",
          status: "failed",
          createdAt: "2026-03-31T12:00:00.000Z",
          failureCode: "sandbox_bootstrap_failed",
          failureMessage: "Could not start sandbox runtime because image pull failed.",
        }),
      ],
      nextPage: null,
      previousPage: null,
      totalResults: 4,
    },
  },
  render: function RenderStory(args): React.JSX.Element {
    return <SessionsPageStory {...args} />;
  },
} satisfies Meta<typeof SessionsPageStory>;

export default meta;

type Story = StoryObj<typeof meta>;

export const MixedStates: Story = {};

export const EmptyState: Story = {
  args: {
    sandboxInstancesList: {
      items: [],
      nextPage: null,
      previousPage: null,
      totalResults: 0,
    },
  },
};
