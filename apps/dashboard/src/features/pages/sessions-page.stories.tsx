import type { Meta, StoryObj } from "@storybook/react-vite";
import { QueryClientProvider } from "@tanstack/react-query";
import { useState } from "react";
import { MemoryRouter } from "react-router";

import type { LaunchableSandboxProfilesResult } from "../sandbox-profiles/sandbox-profiles-types.js";
import type { SandboxInstancesListResult } from "../sessions/sessions-types.js";
import { SessionsPage } from "./sessions-page.js";
import {
  buildStoryLaunchableSandboxProfile,
  buildStorySandboxInstanceListItem,
  createSessionsPageStoryQueryClient,
} from "./sessions-page.story-fixtures.js";

type SessionsPageStoryArgs = {
  launchableProfiles?: LaunchableSandboxProfilesResult["items"];
  sandboxInstancesList?: SandboxInstancesListResult;
};

function SessionsPageStory(input: SessionsPageStoryArgs): React.JSX.Element {
  const [queryClient] = useState(() => {
    const storyData = {
      ...(input.launchableProfiles !== undefined
        ? { launchableProfiles: input.launchableProfiles }
        : {}),
      ...(input.sandboxInstancesList !== undefined
        ? { sandboxInstancesList: input.sandboxInstancesList }
        : {}),
    };

    return createSessionsPageStoryQueryClient(storyData);
  });

  return (
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <div className="mx-auto w-full max-w-6xl px-6 py-8">
          <SessionsPage />
        </div>
      </MemoryRouter>
    </QueryClientProvider>
  );
}

const meta = {
  title: "Dashboard/Pages/SessionsPage",
  component: SessionsPageStory,
  tags: ["autodocs"],
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
    sandboxInstancesList: {
      items: [
        buildStorySandboxInstanceListItem({
          id: "sbi_running",
          sandboxProfileDisplayName: "Repo Maintainer",
          status: "running",
          createdAt: "2026-04-01T09:00:00.000Z",
        }),
        buildStorySandboxInstanceListItem({
          id: "sbi_starting",
          sandboxProfileDisplayName: "Finance Investigator",
          status: "starting",
          createdAt: "2026-04-01T08:55:00.000Z",
        }),
        buildStorySandboxInstanceListItem({
          id: "sbi_stopped",
          sandboxProfileDisplayName: "Docs Maintainer",
          status: "stopped",
          createdAt: "2026-03-31T15:30:00.000Z",
        }),
        buildStorySandboxInstanceListItem({
          id: "sbi_failed",
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

export const PaginatedResults: Story = {
  args: {
    sandboxInstancesList: {
      items: [
        buildStorySandboxInstanceListItem({
          id: "sbi_page_1",
          sandboxProfileDisplayName: "Repo Maintainer",
          status: "running",
          createdAt: "2026-04-01T09:00:00.000Z",
        }),
        buildStorySandboxInstanceListItem({
          id: "sbi_page_2",
          sandboxProfileDisplayName: "Docs Maintainer",
          status: "stopped",
          createdAt: "2026-03-31T15:30:00.000Z",
        }),
      ],
      nextPage: {
        after: "cursor_after_2",
        limit: 20,
      },
      previousPage: {
        before: "cursor_before_0",
        limit: 20,
      },
      totalResults: 42,
    },
  },
};

export const FailedSessions: Story = {
  args: {
    sandboxInstancesList: {
      items: [
        buildStorySandboxInstanceListItem({
          id: "sbi_failed_runtime",
          sandboxProfileDisplayName: "Webhook Debugger",
          status: "failed",
          createdAt: "2026-03-31T12:00:00.000Z",
          failureCode: "sandbox_bootstrap_failed",
          failureMessage: "Could not start sandbox runtime because image pull failed.",
        }),
        buildStorySandboxInstanceListItem({
          id: "sbi_failed_init",
          sandboxProfileDisplayName: "Finance Investigator",
          status: "failed",
          createdAt: "2026-03-31T11:15:00.000Z",
          failureCode: "session_init_failed",
          failureMessage:
            "The sandbox started, but the initialization command exited with code 127.",
        }),
      ],
      nextPage: null,
      previousPage: null,
      totalResults: 2,
    },
  },
};
