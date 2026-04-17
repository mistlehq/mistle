import type { Meta, StoryObj } from "@storybook/react-vite";
import type React from "react";

import { withDashboardCenteredStory } from "../../storybook/decorators.js";
import { IntegrationResourceList } from "./integration-resource-list.js";

function renderWithinFixedWidth(
  args: React.ComponentProps<typeof IntegrationResourceList>,
): React.JSX.Element {
  return (
    <div className="w-[48rem] max-w-full">
      <IntegrationResourceList {...args} />
    </div>
  );
}

const comprehensiveStateArgs: React.ComponentProps<typeof IntegrationResourceList> = {
  connectionId: "icn_story",
  onRefreshResource: () => {},
  resources: [
    {
      count: 11,
      kind: "repository",
      lastSyncedAt: "2026-04-13T15:37:00.000Z",
      syncState: "ready",
    },
    {
      count: 2,
      kind: "workspace",
      lastSyncedAt: "2026-04-13T15:37:00.000Z",
      syncState: "syncing",
      isRefreshing: true,
    },
    {
      count: 0,
      kind: "branch",
      syncState: "never-synced",
    },
    {
      count: 0,
      kind: "user",
      syncState: "error",
    },
  ],
  resourceContentByKey: new Map([
    [
      "icn_story:repository",
      {
        errorMessage: null,
        isLoading: false,
        items: [
          {
            id: "repo_1",
            familyId: "github",
            kind: "repository",
            handle: "mistlehq/dashboard",
            displayName: "mistlehq/dashboard",
            status: "accessible",
            metadata: {},
          },
          {
            id: "repo_2",
            familyId: "github",
            kind: "repository",
            handle: "mistlehq/control-plane-api",
            displayName: "mistlehq/control-plane-api",
            status: "accessible",
            metadata: {},
          },
        ],
        kind: "repository",
      },
    ],
    [
      "icn_story:workspace",
      {
        errorMessage: null,
        isLoading: true,
        items: [],
        kind: "workspace",
      },
    ],
    [
      "icn_story:branch",
      {
        errorMessage: null,
        isLoading: false,
        items: [],
        kind: "branch",
      },
    ],
    [
      "icn_story:user",
      {
        errorMessage: "GitHub returned a 403 while loading user data.",
        isLoading: false,
        items: [],
        kind: "user",
      },
    ],
  ]),
};

const meta = {
  title: "Dashboard/Integrations/Connection/ResourceList",
  component: IntegrationResourceList,
  decorators: [withDashboardCenteredStory],
  args: comprehensiveStateArgs,
  render: renderWithinFixedWidth,
} satisfies Meta<typeof IntegrationResourceList>;

export default meta;

type Story = StoryObj<typeof meta>;

export const AllStates: Story = {
  args: comprehensiveStateArgs,
};
