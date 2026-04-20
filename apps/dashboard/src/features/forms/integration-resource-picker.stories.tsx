import type { Meta, StoryObj } from "@storybook/react-vite";
import type React from "react";

import { withDashboardCenteredStory } from "../../storybook/decorators.js";
import type { IntegrationConnectionResource } from "../integrations/integrations-service.js";
import { useIntegrationResourcePickerStoryState } from "./integration-resource-picker-story-harness.js";
import { RepositoryItems } from "./integration-resource-picker-story-support.js";
import { type IntegrationResourceListViewState } from "./integration-resource-picker-view-model.js";
import { IntegrationResourcePickerView } from "./integration-resource-picker-view.js";

function createReadyState(
  items: readonly IntegrationConnectionResource[],
): IntegrationResourceListViewState {
  return {
    mode: "ready",
    items,
  };
}

const meta = {
  title: "Dashboard/Forms/Integration Resource Picker",
  component: IntegrationResourcePickerView,
  decorators: [withDashboardCenteredStory],
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
    onSelectionChange: () => {},
    onToggleAll: () => {},
    onRefresh: () => {},
    onBlur: () => {},
    onFocus: () => {},
  },
} satisfies Meta<typeof IntegrationResourcePickerView>;

export default meta;

type Story = StoryObj<typeof meta>;

function StorySection(input: {
  title: string;
  description?: string;
  children: React.ReactNode;
}): React.JSX.Element {
  return (
    <section className="flex flex-col gap-3">
      <div className="flex flex-col gap-1">
        <h3 className="text-sm font-medium">{input.title}</h3>
        {input.description === undefined ? null : (
          <p className="text-muted-foreground text-sm">{input.description}</p>
        )}
      </div>
      {input.children}
    </section>
  );
}

export const Ready: Story = {};

export const InteractiveSelection: Story = {
  render: function RenderStory(args): React.JSX.Element {
    const storyState = useIntegrationResourcePickerStoryState({
      items: RepositoryItems,
      title: "Repositories",
      refreshLabel: args.refreshLabel,
      syncMetadata: "Last synced Mar 9, 2026, 12:00 PM",
      emptyMessage: "No repositories available for this connection.",
      initialSelectedHandles: ["mistle/main-dashboard", "mistle/control-plane-api"],
    });

    return (
      <IntegrationResourcePickerView
        {...args}
        emptyMessage={storyState.viewModel.emptyMessage}
        listState={createReadyState(storyState.visibleItems)}
        onSelectionChange={storyState.setSelectedHandles}
        onSearchChange={storyState.setSearch}
        onToggleAll={storyState.toggleAll}
        search={storyState.search}
        searchPlaceholder={storyState.viewModel.searchPlaceholder}
        selectedHandles={storyState.selectedHandles}
        visibleItems={storyState.visibleItems}
        refreshTooltip={storyState.viewModel.refreshTooltip}
      />
    );
  },
};

export const StateGallery: Story = {
  render: function RenderStory(args): React.JSX.Element {
    return (
      <div className="flex w-[44rem] flex-col gap-8">
        <StorySection
          description="Closed-state empty sync guidance remains visible below the field."
          title="Never Synced"
        >
          <IntegrationResourcePickerView
            {...args}
            listState={createReadyState([])}
            refreshTooltip="Refresh repositories"
            searchPlaceholder="Search 0 repositories"
            visibleItems={[]}
          />
        </StorySection>

        <StorySection
          description="Refresh errors stay visible even when the picker is closed."
          title="Refresh Failed"
        >
          <IntegrationResourcePickerView
            {...args}
            refreshErrorMessage="Could not refresh resources for this connection."
          />
        </StorySection>

        <StorySection
          description="Sync failures with cached results still show the error below the field."
          title="Sync Failed"
        >
          <IntegrationResourcePickerView
            {...args}
            listState={{
              mode: "error",
              message: "GitHub rejected the resource sync for this connection.",
            }}
            refreshTooltip="Refresh repositories\nGitHub rejected the resource sync for this connection."
            visibleItems={RepositoryItems.slice(0, 3)}
          />
        </StorySection>

        <StorySection
          description="Unavailable selected repositories stay visible outside the popup."
          title="Stale Selected Repositories"
        >
          <IntegrationResourcePickerView
            {...args}
            listState={createReadyState(RepositoryItems.slice(0, 3))}
            selectedHandles={["mistle/main-dashboard", "mistle/private-internal-tools"]}
            unavailableSelectedHandles={["mistle/private-internal-tools"]}
            visibleItems={RepositoryItems.slice(0, 3)}
          />
        </StorySection>
      </div>
    );
  },
};
