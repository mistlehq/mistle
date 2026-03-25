import type { Meta, StoryObj } from "@storybook/react-vite";

import { withDashboardCenteredSurface } from "../../storybook/decorators.js";
import { WebhookAutomationListView } from "./webhook-automation-list-view.js";
import {
  createDefaultWebhookAutomationListStoryItems,
  createRowLevelIssueWebhookAutomationListItemViewModel,
} from "./webhook-automation-test-fixtures.js";

const SampleItems = createDefaultWebhookAutomationListStoryItems();
const UnavailableSavedEventItem = SampleItems[2];
const RowLevelIssueItem = createRowLevelIssueWebhookAutomationListItemViewModel();

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
    items: UnavailableSavedEventItem === undefined ? [] : [UnavailableSavedEventItem],
    totalResults: 1,
  },
};

export const RowLevelIssue: Story = {
  args: {
    items: [RowLevelIssueItem],
    totalResults: 1,
  },
};
