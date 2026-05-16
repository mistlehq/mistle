import type { Meta, StoryObj } from "@storybook/react-vite";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState } from "react";
import { MemoryRouter } from "react-router";

import { withDashboardPageStory } from "../../storybook/decorators.js";
import { sandboxProfilesListQueryKey } from "../sandbox-profiles/sandbox-profiles-query-keys.js";
import type { SandboxProfilesListResult } from "../sandbox-profiles/sandbox-profiles-types.js";
import { SandboxProfilesPage } from "./sandbox-profiles-page.js";

type SandboxProfilesPageStoryArgs = {
  sandboxProfilesList: SandboxProfilesListResult;
};

function createSandboxProfilesStoryQueryClient(
  sandboxProfilesList: SandboxProfilesListResult,
): QueryClient {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
        staleTime: Number.POSITIVE_INFINITY,
      },
    },
  });

  queryClient.setQueryData(
    sandboxProfilesListQueryKey({
      limit: 20,
      after: null,
      before: null,
    }),
    sandboxProfilesList,
  );

  return queryClient;
}

function SandboxProfilesPageStory(args: SandboxProfilesPageStoryArgs): React.JSX.Element {
  const [queryClient] = useState(() =>
    createSandboxProfilesStoryQueryClient(args.sandboxProfilesList),
  );

  return (
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={["/sandbox-profiles"]}>
        <SandboxProfilesPage />
      </MemoryRouter>
    </QueryClientProvider>
  );
}

const meta = {
  title: "Dashboard/SandboxProfiles/Page",
  component: SandboxProfilesPageStory,
  tags: ["autodocs"],
  parameters: {
    layout: "fullscreen",
  },
  decorators: [withDashboardPageStory],
  args: {
    sandboxProfilesList: {
      items: [
        {
          activeVersion: 3,
          createdAt: "2026-05-01T00:00:00.000Z",
          displayName: "Repo Maintainer",
          id: "sbp_repo_maintainer",
          organizationId: "org_123",
          status: "active",
          updatedAt: "2026-05-14T08:30:00.000Z",
        },
      ],
      nextPage: null,
      previousPage: null,
      totalResults: 1,
    },
  },
  render: function RenderStory(args): React.JSX.Element {
    return <SandboxProfilesPageStory {...args} />;
  },
} satisfies Meta<SandboxProfilesPageStoryArgs>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const EmptyState: Story = {
  args: {
    sandboxProfilesList: {
      items: [],
      nextPage: null,
      previousPage: null,
      totalResults: 0,
    },
  },
};
