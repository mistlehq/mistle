import type { Meta, StoryObj } from "@storybook/react-vite";

import { withDashboardCenteredSurface } from "../../storybook/decorators.js";
import type { WebhookAutomationListItemViewModel } from "./webhook-automation-list-types.js";
import { WebhookAutomationListView } from "./webhook-automation-list-view.js";

const SampleItems: readonly WebhookAutomationListItemViewModel[] = [
  {
    id: "aut_01jps7k2z2v3qj4k9m0n1p2q3r",
    name: "GitHub pushes to repo triage",
    targetName: "Repo Maintainer",
    events: [
      {
        label: "CI completed",
        logoKey: "github",
      },
      {
        label: "Pull request opened",
        logoKey: "github",
      },
      {
        label: "Issue comment created",
        logoKey: "github",
      },
    ],
    updatedAtLabel: "6 min ago",
    enabled: true,
  },
  {
    id: "aut_01jps7mhvgc0p7e01b4z4r7c0m",
    name: "Stripe payouts incident intake",
    targetName: "Finance Investigator",
    events: [
      {
        label: "Payout failed",
      },
    ],
    updatedAtLabel: "1 day ago",
    enabled: false,
  },
  {
    id: "aut_01jps7qxbxw6kxdj1r9s9v8y2h",
    name: "Legacy GitHub escalation",
    targetName: "Incident Commander",
    events: [
      {
        label: "github.push.deleted",
        unavailable: true,
      },
      {
        label: "Pull request opened",
        logoKey: "github",
      },
    ],
    updatedAtLabel: "3 days ago",
    enabled: true,
  },
];

const meta = {
  title: "Dashboard/Automations/WebhookAutomationListView",
  component: WebhookAutomationListView,
  decorators: [withDashboardCenteredSurface],
  parameters: {
    layout: "fullscreen",
  },
  args: {
    items: SampleItems,
    isLoading: false,
    errorMessage: null,
    totalResults: SampleItems.length,
    hasNextPage: false,
    hasPreviousPage: false,
    nextPageDisabled: false,
    previousPageDisabled: false,
    onNextPage: function onNextPage() {},
    onPreviousPage: function onPreviousPage() {},
    onOpenAutomation: function onOpenAutomation() {},
    onRetry: function onRetry() {},
  },
} satisfies Meta<typeof WebhookAutomationListView>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const Paginated: Story = {
  args: {
    hasNextPage: true,
    hasPreviousPage: true,
    totalResults: 24,
  },
};

export const Empty: Story = {
  args: {
    items: [],
  },
};

export const Loading: Story = {
  args: {
    isLoading: true,
    items: [],
  },
};

export const ErrorState: Story = {
  args: {
    items: [],
    errorMessage: "The active organization could not be resolved for this request.",
  },
};

export const UnavailableSavedEvent: Story = {
  args: {
    items: [SampleItems[2]].filter(
      (item): item is WebhookAutomationListItemViewModel => item !== undefined,
    ),
    totalResults: 1,
  },
};
