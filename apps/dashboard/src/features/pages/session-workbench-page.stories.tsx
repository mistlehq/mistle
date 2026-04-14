import type { Meta, StoryObj } from "@storybook/react-vite";

import { withDashboardWorkspaceStory } from "../../storybook/decorators.js";
import { buildSandboxInstanceListItemFixture } from "./sessions-page.story-fixtures.js";
import { SessionsStoryHarness } from "./sessions-story-harness.js";

type SessionWorkbenchPageStoryArgs = {
  sandboxInstanceId: string;
  sessionTitle: string | null;
  sandboxStatus: "pending" | "starting" | "running" | "stopped" | "failed";
  connectable: boolean;
};

const meta = {
  title: "Dashboard/Sessions/SessionWorkbench/RoutedPage",
  tags: ["autodocs"],
  parameters: {
    layout: "fullscreen",
  },
  decorators: [withDashboardWorkspaceStory],
  args: {
    sandboxInstanceId: "sbi_storybook",
    sessionTitle: "Investigate flaky title rendering",
    sandboxStatus: "running",
    connectable: true,
  },
  render: function RenderStory(args): React.JSX.Element {
    return (
      <SessionsStoryHarness
        initialEntries={[`/sessions/${args.sandboxInstanceId}`]}
        renderSessionWorkbenchPage
        sandboxInstanceStatus={{
          id: args.sandboxInstanceId,
          title: args.sessionTitle,
          status: args.sandboxStatus,
          connectable: args.connectable,
          runtimeContext: args.connectable
            ? {
                launchCwd: null,
                primaryRepositoryRoot: null,
              }
            : null,
        }}
        sandboxInstancesList={{
          items: [
            buildSandboxInstanceListItemFixture({
              id: args.sandboxInstanceId,
              title: args.sessionTitle,
              status: args.sandboxStatus,
              keepaliveActive: args.sandboxStatus === "running",
            }),
          ],
          nextPage: null,
          previousPage: null,
          totalResults: 1,
        }}
      />
    );
  },
} satisfies Meta<SessionWorkbenchPageStoryArgs>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Running: Story = {};

export const Untitled: Story = {
  args: {
    sessionTitle: null,
  },
};

export const Starting: Story = {
  args: {
    sandboxStatus: "starting",
    connectable: false,
    sessionTitle: "Preparing repository handoff",
  },
};

export const LongTitle: Story = {
  args: {
    sessionTitle:
      "Investigate why the billing reconciliation sandbox stalls after reconnect when replaying a payload with 18 invoices, 6 retries, and a downstream timeout on the ledger write path",
  },
};
