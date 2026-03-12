import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import type React from "react";

import { withDashboardPageWidth } from "../../storybook/decorators.js";
import type { IntegrationConnectionResource } from "../integrations/integrations-service.js";
import {
  IntegrationResourceStringArrayWidgetView,
  type IntegrationResourceListViewState,
} from "./integration-resource-string-array-widget-view.js";

function createRepositoryResource(input: {
  id: string;
  handle: string;
  displayName: string;
}): IntegrationConnectionResource {
  return {
    id: input.id,
    familyId: "github",
    kind: "repository",
    handle: input.handle,
    displayName: input.displayName,
    status: "accessible",
    metadata: {},
  };
}

const RepositoryItems = [
  createRepositoryResource({
    id: "repo_1",
    handle: "mistle/main-dashboard",
    displayName: "main-dashboard",
  }),
  createRepositoryResource({
    id: "repo_2",
    handle: "mistle/control-plane-api",
    displayName: "control-plane-api",
  }),
  createRepositoryResource({
    id: "repo_3",
    handle: "mistle/sandbox-runtime",
    displayName: "sandbox-runtime",
  }),
  createRepositoryResource({
    id: "repo_4",
    handle: "mistle/codex-bridge",
    displayName: "codex-bridge",
  }),
] as const satisfies readonly IntegrationConnectionResource[];

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
    const [search, setSearch] = useState("");
    const [selectedHandles, setSelectedHandles] = useState<readonly string[]>([
      "mistle/main-dashboard",
      "mistle/control-plane-api",
    ]);

    const normalizedSearch = search.trim().toLowerCase();
    const visibleItems =
      normalizedSearch.length === 0
        ? RepositoryItems
        : RepositoryItems.filter((item) => {
            const displayName = item.displayName.toLowerCase();
            const handle = item.handle.toLowerCase();
            return displayName.includes(normalizedSearch) || handle.includes(normalizedSearch);
          });

    return (
      <IntegrationResourceStringArrayWidgetView
        {...args}
        listState={createReadyState(visibleItems)}
        onSearchChange={setSearch}
        onToggleHandle={(handle) => {
          setSelectedHandles((current) =>
            current.includes(handle)
              ? current.filter((selectedHandle) => selectedHandle !== handle)
              : [...current, handle],
          );
        }}
        search={search}
        selectedHandles={selectedHandles}
        visibleItems={visibleItems}
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
