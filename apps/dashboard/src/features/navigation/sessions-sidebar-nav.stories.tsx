import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";

import { withDashboardPageStory } from "../../storybook/decorators.js";
import { buildSandboxInstanceListItemFixture } from "../pages/sessions-page.story-fixtures.js";
import { SessionsStoryHarness } from "../pages/sessions-story-harness.js";
import type { SandboxInstancesListResult } from "../sessions/sessions-types.js";
import { type SessionsSidebarSourceItem } from "./sessions-sidebar-nav-model.js";

type SessionsSidebarStoryArgs = {
  items: SessionsSidebarSourceItem[];
};

function SessionsSidebarStory(input: SessionsSidebarStoryArgs): React.JSX.Element {
  const [sandboxInstancesList] = useState<SandboxInstancesListResult>(() => ({
    items: input.items.map((item) =>
      buildSandboxInstanceListItemFixture({
        id: item.id,
        title: item.title,
        sandboxProfileId: item.sandboxProfileId,
        sandboxProfileDisplayName: item.sandboxProfileDisplayName,
        status: item.status,
        createdAt: item.createdAt,
        keepaliveActive: item.keepaliveActive,
      }),
    ),
    nextPage: null,
    previousPage: null,
    totalResults: input.items.length,
  }));

  return (
    <SessionsStoryHarness
      initialEntries={["/sessions/new"]}
      sandboxInstancesList={sandboxInstancesList}
    />
  );
}

const meta = {
  title: "Dashboard/Sessions/SidebarNav",
  component: SessionsSidebarStory,
  tags: ["autodocs"],
  decorators: [withDashboardPageStory],
  parameters: {
    layout: "fullscreen",
  },
  args: {
    items: [
      {
        id: "sbi_working_alpha",
        title:
          "Investigate flaky test run after gateway lease handoff in the repo-maintainer sandbox",
        sandboxProfileId: "sbp_repo_maintainer",
        sandboxProfileDisplayName: "Repo Maintainer",
        status: "running",
        createdAt: "2026-04-08T09:00:00.000Z",
        keepaliveActive: true,
      },
      {
        id: "sbi_ready_alpha",
        title: "Review migration draft",
        sandboxProfileId: "sbp_repo_maintainer",
        sandboxProfileDisplayName: "Repo Maintainer",
        status: "running",
        createdAt: "2026-04-08T08:50:00.000Z",
        keepaliveActive: false,
      },
      {
        id: "sbi_starting_docs",
        title:
          "Draft onboarding guide for new operators working across control plane and gateway runtime flows",
        sandboxProfileId: "sbp_docs",
        sandboxProfileDisplayName: "Docs Maintainer",
        status: "starting",
        createdAt: "2026-04-08T08:40:00.000Z",
        keepaliveActive: false,
      },
      {
        id: "sbi_stopped_finance",
        title: null,
        sandboxProfileId: "sbp_finance",
        sandboxProfileDisplayName: "Finance Investigator",
        status: "stopped",
        createdAt: "2026-04-08T07:30:00.000Z",
        keepaliveActive: false,
      },
      {
        id: "sbi_failed_hidden",
        title: "Hidden failed run",
        sandboxProfileId: "sbp_hidden",
        sandboxProfileDisplayName: "Hidden Profile",
        status: "failed",
        createdAt: "2026-04-08T06:30:00.000Z",
        keepaliveActive: false,
      },
    ],
  },
  render: function RenderStory(args): React.JSX.Element {
    return <SessionsSidebarStory {...args} />;
  },
} satisfies Meta<typeof SessionsSidebarStory>;

export default meta;

type Story = StoryObj<typeof meta>;

export const MixedOpenableStates: Story = {};

export const EmptyState: Story = {
  args: {
    items: [
      {
        id: "sbi_failed_only",
        title: "Failed bootstrap",
        sandboxProfileId: "sbp_hidden",
        sandboxProfileDisplayName: "Hidden Profile",
        status: "failed",
        createdAt: "2026-04-08T05:00:00.000Z",
        keepaliveActive: false,
      },
    ],
  },
  parameters: {
    docs: {
      description: {
        story:
          "`New` now links to `/sessions/new`, so the empty sessions sidebar routes into the dedicated new-session page instead of opening an in-sidebar dialog.",
      },
    },
  },
};
