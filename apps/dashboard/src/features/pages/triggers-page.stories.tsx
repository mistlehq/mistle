import type { Meta, StoryObj } from "@storybook/react-vite";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState } from "react";
import { MemoryRouter } from "react-router";

import { withDashboardPageStory } from "../../storybook/decorators.js";
import { createTriggerListEvent } from "../triggers/trigger-list-test-fixtures.js";
import { triggersListQueryKey } from "../triggers/triggers-query-keys.js";
import type { TriggersListResult } from "../triggers/triggers-types.js";
import { TriggersPage } from "./triggers-page.js";

type TriggersPageStoryArgs = {
  triggersList: TriggersListResult;
};

function createTriggersStoryQueryClient(triggersList: TriggersListResult): QueryClient {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
        staleTime: Number.POSITIVE_INFINITY,
      },
    },
  });

  queryClient.setQueryData(
    triggersListQueryKey({
      limit: 25,
      after: null,
      before: null,
    }),
    triggersList,
  );

  return queryClient;
}

function TriggersPageStory(args: TriggersPageStoryArgs): React.JSX.Element {
  const [queryClient] = useState(() => createTriggersStoryQueryClient(args.triggersList));

  return (
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={["/triggers"]}>
        <TriggersPage />
      </MemoryRouter>
    </QueryClientProvider>
  );
}

const meta = {
  title: "Dashboard/Triggers/Page",
  component: TriggersPageStory,
  tags: ["autodocs"],
  parameters: {
    layout: "fullscreen",
  },
  decorators: [withDashboardPageStory],
  args: {
    triggersList: {
      items: [
        {
          enabled: true,
          id: "atm_webhook_story",
          kind: "webhook",
          name: "Review pull requests",
          source: {
            events: [createTriggerListEvent({ label: "Pull request opened" })],
            kind: "webhook",
          },
          target: {
            primaryRepositoryId: "repo_mistle",
            primaryRepositoryName: "mistlehq/mistle",
            sandboxProfileId: "sbp_repo_maintainer",
            sandboxProfileName: "Repo Maintainer",
            sandboxProfileVersion: 3,
          },
          updatedAt: "2026-05-14T08:30:00.000Z",
        },
      ],
      nextPage: null,
      previousPage: null,
      totalResults: 1,
    },
  },
  render: function RenderStory(args): React.JSX.Element {
    return <TriggersPageStory {...args} />;
  },
} satisfies Meta<TriggersPageStoryArgs>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const EmptyState: Story = {
  args: {
    triggersList: {
      items: [],
      nextPage: null,
      previousPage: null,
      totalResults: 0,
    },
  },
};
