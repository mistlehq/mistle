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

const allStateArgs: React.ComponentProps<typeof IntegrationResourceList> = {
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
      count: 0,
      isRefreshing: true,
      kind: "branch",
      syncState: "syncing",
    },
    {
      count: 0,
      kind: "user",
      syncState: "error",
    },
    {
      count: 2,
      kind: "team",
      lastSyncedAt: "2026-04-13T15:37:00.000Z",
      syncState: "ready",
    },
  ],
  resourceItemsByKey: new Map([
    [
      "icn_story:repository",
      {
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
        errorMessage: null,
      },
    ],
    [
      "icn_story:branch",
      {
        isLoading: true,
        items: [],
        kind: "branch",
        errorMessage: null,
      },
    ],
    [
      "icn_story:user",
      {
        isLoading: false,
        items: [],
        kind: "user",
        errorMessage: "GitHub returned a 403 while loading user data.",
      },
    ],
    [
      "icn_story:team",
      {
        isLoading: false,
        items: [
          {
            id: "team_1",
            familyId: "github",
            kind: "team",
            handle: "platform",
            displayName: "Platform (mistlehq)",
            status: "accessible",
            metadata: {
              organizationLogins: ["mistlehq"],
            },
          },
          {
            id: "team_2",
            familyId: "github",
            kind: "team",
            handle: "security",
            displayName: "Security (mistlehq)",
            status: "accessible",
            metadata: {
              organizationLogins: ["mistlehq"],
            },
          },
        ],
        kind: "team",
        errorMessage: null,
      },
    ],
  ]),
};

const meta = {
  title: "Dashboard/Integrations/Primitives/ResourceList",
  component: IntegrationResourceList,
  decorators: [withDashboardCenteredStory],
  args: allStateArgs,
  render: renderWithinFixedWidth,
} satisfies Meta<typeof IntegrationResourceList>;

export default meta;

type Story = StoryObj<typeof meta>;

export const AllStates: Story = {
  args: allStateArgs,
};
