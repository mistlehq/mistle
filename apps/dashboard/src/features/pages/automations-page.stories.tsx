import type { Meta, StoryObj } from "@storybook/react-vite";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState } from "react";
import { MemoryRouter } from "react-router";

import { withDashboardPageStory } from "../../storybook/decorators.js";
import { createAutomationListEvent } from "../automations/automation-list-test-fixtures.js";
import { automationsListQueryKey } from "../automations/automations-query-keys.js";
import type { AutomationsListResult } from "../automations/automations-types.js";
import { AutomationsPage } from "./automations-page.js";

type AutomationsPageStoryArgs = {
  automationsList: AutomationsListResult;
};

function createAutomationsStoryQueryClient(automationsList: AutomationsListResult): QueryClient {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
        staleTime: Number.POSITIVE_INFINITY,
      },
    },
  });

  queryClient.setQueryData(
    automationsListQueryKey({
      limit: 25,
      after: null,
      before: null,
    }),
    automationsList,
  );

  return queryClient;
}

function AutomationsPageStory(args: AutomationsPageStoryArgs): React.JSX.Element {
  const [queryClient] = useState(() => createAutomationsStoryQueryClient(args.automationsList));

  return (
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={["/automations"]}>
        <AutomationsPage />
      </MemoryRouter>
    </QueryClientProvider>
  );
}

const meta = {
  title: "Dashboard/Triggers/Page",
  component: AutomationsPageStory,
  tags: ["autodocs"],
  parameters: {
    layout: "fullscreen",
  },
  decorators: [withDashboardPageStory],
  args: {
    automationsList: {
      items: [
        {
          enabled: true,
          id: "atm_webhook_story",
          kind: "webhook",
          name: "Review pull requests",
          source: {
            events: [createAutomationListEvent({ label: "Pull request opened" })],
            kind: "webhook",
          },
          target: {
            primaryRepositoryId: "repo_mistle",
            primaryRepositoryName: "mistlehq/mistle",
            sandboxProfileId: "sbp_repo_maintainer",
            sandboxProfileName: "Repo Maintainer",
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
    return <AutomationsPageStory {...args} />;
  },
} satisfies Meta<AutomationsPageStoryArgs>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const EmptyState: Story = {
  args: {
    automationsList: {
      items: [],
      nextPage: null,
      previousPage: null,
      totalResults: 0,
    },
  },
};
