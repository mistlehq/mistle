import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";

import { withDashboardPageWidth } from "../../storybook/decorators.js";
import {
  WebhookAutomationTriggerPicker,
  type WebhookAutomationEventOption,
} from "./webhook-automation-trigger-picker.js";

const GitHubEventOptions: readonly WebhookAutomationEventOption[] = [
  {
    value: "github.issue_comment.created",
    label: "Issue comment created",
    category: "Issues",
    logoKey: "github",
  },
  {
    value: "github.issues.opened",
    label: "Issue opened",
    category: "Issues",
    logoKey: "github",
  },
  {
    value: "github.pull_request.opened",
    label: "Pull request opened",
    category: "Pull requests",
    logoKey: "github",
  },
  {
    value: "github.pull_request_review_comment.created",
    label: "Pull request review comment created",
    category: "Pull requests",
    logoKey: "github",
  },
];

function StoryHarness(input: {
  hasConnectedIntegrations: boolean;
  selectedEventTypes: readonly string[];
  eventOptions: readonly WebhookAutomationEventOption[];
  error?: string;
}): React.JSX.Element {
  const [selectedEventTypes, setSelectedEventTypes] = useState([...input.selectedEventTypes]);

  return (
    <div className="max-w-3xl">
      <WebhookAutomationTriggerPicker
        error={input.error}
        eventOptions={input.eventOptions}
        hasConnectedIntegrations={input.hasConnectedIntegrations}
        onValueChange={setSelectedEventTypes}
        selectedEventTypes={selectedEventTypes}
      />
    </div>
  );
}

const meta = {
  title: "Dashboard/Automations/WebhookAutomationTriggerPicker",
  component: StoryHarness,
  decorators: [withDashboardPageWidth],
} satisfies Meta<typeof StoryHarness>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: {
    hasConnectedIntegrations: true,
    selectedEventTypes: ["github.pull_request.opened", "github.issue_comment.created"],
    eventOptions: GitHubEventOptions,
  },
};

export const NoSelection: Story = {
  args: {
    hasConnectedIntegrations: true,
    selectedEventTypes: [],
    eventOptions: GitHubEventOptions,
  },
};

export const NoConnectedIntegrations: Story = {
  args: {
    hasConnectedIntegrations: false,
    selectedEventTypes: [],
    eventOptions: [],
  },
};

export const NoTriggersAvailable: Story = {
  args: {
    hasConnectedIntegrations: true,
    selectedEventTypes: [],
    eventOptions: [],
  },
};

export const UnavailableSavedTrigger: Story = {
  args: {
    hasConnectedIntegrations: true,
    selectedEventTypes: ["github.pull_request.opened", "github.push.deleted"],
    eventOptions: [
      ...GitHubEventOptions,
      {
        value: "github.push.deleted",
        label: "github.push.deleted",
        description: "No longer available from your connected integrations.",
        category: "Unavailable",
        logoKey: "github",
        unavailable: true,
      },
    ],
  },
};
