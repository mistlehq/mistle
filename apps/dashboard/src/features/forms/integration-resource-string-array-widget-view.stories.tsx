import type { Meta, StoryObj } from "@storybook/react-vite";
import type React from "react";

import { withDashboardPageWidth } from "../../storybook/decorators.js";
import type { IntegrationConnectionResource } from "../integrations/integrations-service.js";
import { useIntegrationResourceStringArrayWidgetStoryState } from "./integration-resource-string-array-widget-story-harness.js";
import { RepositoryItems } from "./integration-resource-string-array-widget-story-support.js";
import { type IntegrationResourceListViewState } from "./integration-resource-string-array-widget-view-model.js";
import { IntegrationResourceStringArrayWidgetView } from "./integration-resource-string-array-widget-view.js";

function createReadyState(
  items: readonly IntegrationConnectionResource[],
): IntegrationResourceListViewState {
  return {
    mode: "ready",
    items,
  };
}

const meta = {
  title: "Dashboard/Forms/IntegrationResourceStringArrayWidgetView",
  component: IntegrationResourceStringArrayWidgetView,
  decorators: [withDashboardPageWidth],
  args: {
    id: "storybook-repositories",
    label: "Repositories",
    search: "",
    searchPlaceholder: "Search 24 repositories",
    refreshLabel: "Refresh repositories",
    refreshTooltip: "Refresh repositories\nLast synced Mar 9, 2026, 12:00 PM",
    selectedHandles: [],
    unavailableSelectedHandles: [],
    listState: createReadyState(RepositoryItems),
    visibleItems: RepositoryItems,
    isRefreshing: false,
    refreshErrorMessage: null,
    emptyMessage: "No repositories available for this connection.",
    onSearchChange: () => {},
    onToggleHandle: () => {},
    onRefresh: () => {},
    onBlur: () => {},
    onFocus: () => {},
  },
} satisfies Meta<typeof IntegrationResourceStringArrayWidgetView>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Ready: Story = {};

export const InteractiveSelection: Story = {
  render: function RenderStory(args): React.JSX.Element {
    const storyState = useIntegrationResourceStringArrayWidgetStoryState({
      items: RepositoryItems,
      title: "Repositories",
      refreshLabel: args.refreshLabel,
      syncMetadata: "Last synced Mar 9, 2026, 12:00 PM",
      emptyMessage: "No repositories available for this connection.",
      initialSelectedHandles: ["mistle/main-dashboard", "mistle/control-plane-api"],
    });

    return (
      <IntegrationResourceStringArrayWidgetView
        {...args}
        emptyMessage={storyState.viewModel.emptyMessage}
        listState={createReadyState(storyState.visibleItems)}
        onSearchChange={storyState.setSearch}
        onToggleHandle={storyState.toggleHandle}
        search={storyState.search}
        searchPlaceholder={storyState.viewModel.searchPlaceholder}
        selectedHandles={storyState.selectedHandles}
        visibleItems={storyState.visibleItems}
        refreshTooltip={storyState.viewModel.refreshTooltip}
      />
    );
  },
};

export const NeverSyncedEmpty: Story = {
  args: {
    listState: createReadyState([]),
    searchPlaceholder: "Search 0 repositories",
    refreshTooltip: "Refresh repositories",
    emptyMessage: "Connection has not been synced yet. Use refresh to sync.",
    visibleItems: [],
  },
};

export const Syncing: Story = {
  args: {
    isRefreshing: true,
    refreshTooltip: "Refresh repositories\nLast synced Mar 9, 2026, 12:00 PM",
  },
};

export const EmptyAfterSync: Story = {
  args: {
    listState: createReadyState([]),
    searchPlaceholder: "Search 0 repositories",
    refreshTooltip: "Refresh repositories\nLast synced Mar 9, 2026, 12:00 PM",
    emptyMessage: "No repositories are available for this connection.",
    visibleItems: [],
  },
};

export const SyncFailed: Story = {
  args: {
    listState: {
      mode: "error",
      message: "GitHub rejected the resource sync for this connection.",
    },
    refreshTooltip: "Refresh repositories\nGitHub rejected the resource sync for this connection.",
    visibleItems: RepositoryItems.slice(0, 3),
  },
};

export const RefreshFailed: Story = {
  args: {
    refreshErrorMessage: "Could not refresh resources for this connection.",
    visibleItems: RepositoryItems,
  },
};

export const StaleSelectedRepositories: Story = {
  args: {
    selectedHandles: ["mistle/main-dashboard", "mistle/private-internal-tools"],
    unavailableSelectedHandles: ["mistle/private-internal-tools"],
    listState: createReadyState(RepositoryItems.slice(0, 3)),
    visibleItems: RepositoryItems.slice(0, 3),
  },
};

export const Loading: Story = {
  args: {
    listState: {
      mode: "loading",
    },
    refreshTooltip: "Refresh repositories",
    visibleItems: [],
  },
};
