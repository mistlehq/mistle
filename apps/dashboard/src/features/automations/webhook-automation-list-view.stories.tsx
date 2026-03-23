import type { Meta, StoryObj } from "@storybook/react-vite";

import { withDashboardCenteredSurface } from "../../storybook/decorators.js";
import {
  WebhookAutomationListView,
  type WebhookAutomationListItemViewModel,
} from "./webhook-automation-list-view.js";

const SampleItems: readonly WebhookAutomationListItemViewModel[] = [
  {
    id: "aut_01jps7k2z2v3qj4k9m0n1p2q3r",
    name: "GitHub pushes to repo triage",
    integrationConnectionName: "GitHub Engineering",
    sandboxProfileName: "Repo Maintainer",
    eventSummary: "push, pull_request, issues",
    updatedAtLabel: "6 min ago",
    enabled: true,
  },
  {
    id: "aut_01jps7mhvgc0p7e01b4z4r7c0m",
    name: "Stripe payouts incident intake",
    integrationConnectionName: "Stripe Production",
    sandboxProfileName: "Finance Investigator",
    eventSummary: "payout.failed",
    updatedAtLabel: "1 day ago",
    enabled: false,
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
    onOpenAutomation: function onOpenAutomation() {},
    onRetry: function onRetry() {},
  },
} satisfies Meta<typeof WebhookAutomationListView>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {};

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
