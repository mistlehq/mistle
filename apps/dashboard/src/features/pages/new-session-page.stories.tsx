import type { Meta, StoryObj } from "@storybook/react-vite";
import { QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Route, Routes } from "react-router";

import { withDashboardPageStory } from "../../storybook/decorators.js";
import type { LaunchableSandboxProfilesResult } from "../sandbox-profiles/sandbox-profiles-types.js";
import { NewSessionPage } from "./new-session-page.js";
import {
  buildStoryLaunchableSandboxProfile,
  createSessionsPageStoryQueryClient,
} from "./sessions-page.story-fixtures.js";

type NewSessionPageStoryArgs = {
  launchableProfiles: LaunchableSandboxProfilesResult["items"];
  initialSelectedProfileId: string;
};

function NewSessionPageStory(input: NewSessionPageStoryArgs): React.JSX.Element {
  const queryClient = createSessionsPageStoryQueryClient({
    launchableProfiles: input.launchableProfiles,
  });

  return (
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={["/sessions/new"]}>
        <Routes>
          <Route
            element={<NewSessionPage initialSelectedProfileId={input.initialSelectedProfileId} />}
            path="/sessions/new"
          />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>
  );
}

const meta = {
  title: "Dashboard/Sessions/New Session Page",
  component: NewSessionPageStory,
  tags: ["autodocs"],
  parameters: {
    layout: "fullscreen",
  },
  decorators: [withDashboardPageStory],
  args: {
    launchableProfiles: [
      buildStoryLaunchableSandboxProfile({
        id: "sbp_profile_multi_repo",
        displayName: "Engineering Sandbox",
        repositoryOptions: [
          {
            id: "/root/acme/repo-1",
            label: "acme/repo-1",
            path: "/root/acme/repo-1",
          },
          {
            id: "/root/acme/repo-2",
            label: "acme/repo-2",
            path: "/root/acme/repo-2",
          },
        ],
      }),
      buildStoryLaunchableSandboxProfile({
        id: "sbp_profile_single_repo",
        displayName: "Docs Sandbox",
        latestVersion: 7,
        repositoryOptions: [
          {
            id: "/root/acme/docs-site",
            label: "acme/docs-site",
            path: "/root/acme/docs-site",
          },
        ],
      }),
      buildStoryLaunchableSandboxProfile({
        id: "sbp_profile_no_repo",
        displayName: "General Sandbox",
        latestVersion: 2,
      }),
    ],
    initialSelectedProfileId: "sbp_profile_multi_repo",
  },
  render: function RenderStory(args): React.JSX.Element {
    return <NewSessionPageStory {...args} />;
  },
} satisfies Meta<typeof NewSessionPageStory>;

export default meta;

type Story = StoryObj<typeof meta>;

export const MultipleRepositories: Story = {};

export const SingleRepository: Story = {
  args: {
    initialSelectedProfileId: "sbp_profile_single_repo",
  },
};

export const NoRepositories: Story = {
  args: {
    initialSelectedProfileId: "sbp_profile_no_repo",
  },
};
