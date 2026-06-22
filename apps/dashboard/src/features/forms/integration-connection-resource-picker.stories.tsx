import type { Meta, StoryObj } from "@storybook/react-vite";
import type React from "react";

import { withDashboardCenteredStory } from "../../storybook/decorators.js";
import { GitHubUserStoryItems } from "../integrations/github-user-resource-story-support.js";
import { StoryManySlackChannelResources } from "../integrations/slack-channel-resource-story-support.js";
import {
  IntegrationConnectionResourcePickerView,
  toIntegrationConnectionResourcePickerItems,
} from "./integration-connection-resource-picker-view.js";
import { useIntegrationResourcePickerStoryState } from "./integration-resource-picker-story-harness.js";
import { RepositoryItems } from "./integration-resource-picker-story-support.js";
import { type IntegrationResourceListViewState } from "./integration-resource-picker-view-model.js";

function createReadyState(): IntegrationResourceListViewState {
  return {
    mode: "ready",
  };
}

const meta = {
  title: "Dashboard/Forms/Integration Connection Resource Picker",
  component: IntegrationConnectionResourcePickerView,
  decorators: [withDashboardCenteredStory],
  args: {
    id: "storybook-repositories",
    label: "Repositories",
    search: "",
    searchPlaceholder: "Search 24 repositories",
    refreshLabel: "Refresh repositories",
    refreshTooltip: "Refresh repositories\nLast synced Mar 9, 2026, 12:00 PM",
    resourceLabelPlural: "repositories",
    selectedValues: [],
    unavailableSelectedValues: [],
    listState: createReadyState(),
    visibleItems: toIntegrationConnectionResourcePickerItems(RepositoryItems),
    isRefreshing: false,
    refreshErrorMessage: null,
    emptyMessage: "No repositories available for this connection.",
    onSearchChange: () => {},
    onSelectionChange: () => {},
    onRefresh: () => {},
    onBlur: () => {},
    onFocus: () => {},
  },
} satisfies Meta<typeof IntegrationConnectionResourcePickerView>;

export default meta;

type Story = StoryObj<typeof meta>;

const CompactSlackChannelStoryResources = StoryManySlackChannelResources.items.slice(3, 7);

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
      <IntegrationConnectionResourcePickerView
        {...args}
        emptyMessage={storyState.viewModel.emptyMessage}
        listState={createReadyState()}
        onSelectionChange={storyState.setSelectedHandles}
        onSearchChange={storyState.setSearch}
        search={storyState.search}
        searchPlaceholder={storyState.viewModel.searchPlaceholder}
        selectedValues={storyState.selectedHandles}
        visibleItems={toIntegrationConnectionResourcePickerItems(storyState.visibleItems)}
        refreshTooltip={storyState.viewModel.refreshTooltip}
      />
    );
  },
};

export const GitHubUsers: Story = {
  name: "GitHub Users",
  args: {
    id: "storybook-github-users",
    label: "GitHub users",
    searchPlaceholder: `Search ${GitHubUserStoryItems.length.toString()} GitHub users`,
    refreshLabel: "Refresh GitHub users",
    refreshTooltip: "Refresh GitHub users\nLast synced Apr 13, 2026, 3:37 PM",
    selectedValues: ["jon-low", "octocat"],
    listState: createReadyState(),
    visibleItems: toIntegrationConnectionResourcePickerItems(GitHubUserStoryItems),
    emptyMessage: "No GitHub users available for this connection.",
  },
};

export const CompactTriggerField: Story = {
  name: "Compact trigger field",
  args: {
    density: "compact",
    id: "storybook-trigger-channels",
    label: "channel",
    resourceLabelPlural: "channels",
    searchPlaceholder: "Search channels",
    refreshLabel: "Refresh channels",
    refreshTooltip: "Refresh channels\nLast synced Apr 13, 2026, 3:37 PM",
    selectedValues: [
      "C_ENG_MONITOR",
      "C_ENG_PRODUCTION_DEPLOY",
      "C_ENG_STAGING_DEPLOY",
      "C_ENGINEERING",
    ],
    listState: createReadyState(),
    visibleItems: toIntegrationConnectionResourcePickerItems(CompactSlackChannelStoryResources),
    emptyMessage: "No channels available for this connection.",
  },
};

export const ManySlackChannels: Story = {
  name: "Many Slack channels",
  args: {
    density: "compact",
    id: "storybook-many-slack-channels",
    label: "channel",
    resourceLabelPlural: "channels",
    searchPlaceholder: `Search ${StoryManySlackChannelResources.items.length.toString()} channels`,
    refreshLabel: "Refresh channels",
    refreshTooltip: "Refresh channels\nLast synced Apr 13, 2026, 3:37 PM",
    selectedValues: [
      "C_ENG_MONITOR",
      "C_ENG_PRODUCTION_DEPLOY",
      "C_ENG_STAGING_DEPLOY",
      "C_ENGINEERING",
      "C_PLATFORM_RUNTIME",
      "C_RELEASE_COORDINATION",
    ],
    listState: createReadyState(),
    visibleItems: toIntegrationConnectionResourcePickerItems(StoryManySlackChannelResources.items),
    emptyMessage: "No channels available for this connection.",
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
          <IntegrationConnectionResourcePickerView
            {...args}
            listState={createReadyState()}
            refreshTooltip="Refresh repositories"
            searchPlaceholder="Search 0 repositories"
            visibleItems={[]}
          />
        </StorySection>

        <StorySection
          description="Refresh errors stay visible even when the picker is closed."
          title="Refresh Failed"
        >
          <IntegrationConnectionResourcePickerView
            {...args}
            refreshErrorMessage="Could not refresh resources for this connection."
          />
        </StorySection>

        <StorySection
          description="Sync failures with cached results still show the error below the field."
          title="Sync Failed"
        >
          <IntegrationConnectionResourcePickerView
            {...args}
            listState={{
              mode: "error",
              message: "GitHub rejected the resource sync for this connection.",
            }}
            refreshTooltip="Refresh repositories\nGitHub rejected the resource sync for this connection."
            visibleItems={toIntegrationConnectionResourcePickerItems(RepositoryItems.slice(0, 3))}
          />
        </StorySection>

        <StorySection
          description="Unavailable selected repositories stay visible outside the popup."
          title="Stale Selected Repositories"
        >
          <IntegrationConnectionResourcePickerView
            {...args}
            listState={createReadyState()}
            selectedValues={["mistle/main-dashboard", "mistle/private-internal-tools"]}
            unavailableSelectedValues={["mistle/private-internal-tools"]}
            visibleItems={toIntegrationConnectionResourcePickerItems(RepositoryItems.slice(0, 3))}
          />
        </StorySection>
      </div>
    );
  },
};
