import type { Meta, StoryObj } from "@storybook/react-vite";
import type React from "react";
import { expect, userEvent, within } from "storybook/test";

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

const baseArgs: React.ComponentProps<typeof IntegrationResourceList> = {
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
      count: 18,
      kind: "branch",
      lastSyncedAt: "2026-04-13T15:37:00.000Z",
      syncState: "ready",
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
        previewState: null,
      },
    ],
    [
      "icn_story:branch",
      {
        errorMessage: null,
        isLoading: false,
        items: [
          {
            id: "branch_1",
            familyId: "github",
            kind: "branch",
            handle: "main",
            displayName: "main",
            status: "accessible",
            metadata: {},
          },
          {
            id: "branch_2",
            familyId: "github",
            kind: "branch",
            handle: "release/2026.04",
            displayName: "release/2026.04",
            status: "accessible",
            metadata: {},
          },
        ],
        kind: "branch",
        previewState: null,
      },
    ],
  ]),
};

const meta = {
  title: "Dashboard/Integrations/Connection/ResourceList",
  component: IntegrationResourceList,
  decorators: [withDashboardCenteredStory],
  args: baseArgs,
  render: renderWithinFixedWidth,
} satisfies Meta<typeof IntegrationResourceList>;

export default meta;

type Story = StoryObj<typeof meta>;

export const SyncedGroup: Story = {};

export const MixedStates: Story = {
  args: {
    resources: [
      {
        count: 11,
        kind: "repository",
        lastSyncedAt: "2026-04-13T15:37:00.000Z",
        syncState: "ready",
      },
      {
        count: 0,
        kind: "branch",
        syncState: "never-synced",
      },
      {
        count: 4,
        kind: "user",
        lastSyncedAt: "2026-04-13T15:37:00.000Z",
        syncState: "ready",
      },
    ],
    resourceContentByKey: new Map([
      ...baseArgs.resourceContentByKey!.entries(),
      [
        "icn_story:user",
        {
          errorMessage: "GitHub returned a 403 while loading user data.",
          isLoading: false,
          items: [
            {
              id: "user_1",
              familyId: "github",
              kind: "user",
              handle: "dependabot[bot]",
              displayName: "dependabot[bot]",
              status: "accessible",
              metadata: {},
            },
          ],
          kind: "user",
          previewState: "error" as const,
        },
      ],
      [
        "icn_story:branch",
        {
          errorMessage: null,
          isLoading: false,
          items: [],
          kind: "branch",
          previewState: "not-synced" as const,
        },
      ],
    ]),
  },
};

export const Expanded: Story = {
  play: async ({ canvasElement }): Promise<void> => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole("button", { name: "Expand repository resources" }));
    await expect(canvas.getByText("mistlehq/dashboard")).toBeVisible();
  },
};
