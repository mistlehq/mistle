import type { Meta, StoryObj } from "@storybook/react-vite";

import { withDashboardPageStory } from "../../storybook/decorators.js";
import type { SandboxInstancesListResult } from "../sessions/sessions-types.js";
import { buildSandboxInstanceListItemFixture } from "./sessions-page.story-fixtures.js";
import { SessionsStoryHarness } from "./sessions-story-harness.js";

type SessionsPageStoryArgs = {
  initialEntries: readonly string[];
  sandboxInstancesList?: SandboxInstancesListResult;
};

const meta = {
  title: "Dashboard/Sessions/Page",
  tags: ["autodocs"],
  parameters: {
    layout: "fullscreen",
  },
  decorators: [withDashboardPageStory],
  args: {
    initialEntries: ["/sessions"],
    sandboxInstancesList: {
      items: [
        buildSandboxInstanceListItemFixture({
          id: "sbi_running",
          title: "Investigate flaky test run",
          sandboxProfileDisplayName: "Repo Maintainer",
          status: "running",
          updatedAt: "2026-04-01T09:00:00.000Z",
        }),
        buildSandboxInstanceListItemFixture({
          id: "sbi_starting",
          title:
            "Investigate why the billing reconciliation job stalls after sandbox reconnect and document the exact operator runbook for the next on-call handoff",
          sandboxProfileDisplayName: "Finance Investigator",
          status: "starting",
          updatedAt: "2026-04-01T08:55:00.000Z",
        }),
        buildSandboxInstanceListItemFixture({
          id: "sbi_stopped",
          title:
            "Compare the current sidebar truncation behavior with the sessions table so long conversation names stay compact but still reveal the full title on hover",
          sandboxProfileDisplayName: "Docs Maintainer",
          status: "stopped",
          updatedAt: "2026-03-31T15:30:00.000Z",
        }),
        buildSandboxInstanceListItemFixture({
          id: "sbi_failed",
          title: null,
          sandboxProfileDisplayName: "Webhook Debugger",
          status: "failed",
          updatedAt: "2026-03-31T12:00:00.000Z",
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
    return (
      <SessionsStoryHarness
        initialEntries={args.initialEntries}
        {...(args.sandboxInstancesList !== undefined
          ? { sandboxInstancesList: args.sandboxInstancesList }
          : {})}
      />
    );
  },
} satisfies Meta<SessionsPageStoryArgs>;

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
