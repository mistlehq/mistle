import { useState } from "react";

import type { IntegrationConnectionResource } from "../integrations/integrations-service.js";
import { filterRepositoryItems } from "./integration-resource-string-array-widget-story-support.js";
import { buildIntegrationResourceWidgetViewModel } from "./integration-resource-string-array-widget-view-model.js";

export function useIntegrationResourceStringArrayWidgetStoryState(input: {
  items: readonly IntegrationConnectionResource[];
  title: string;
  refreshLabel: string;
  syncMetadata: string | null;
  emptyMessage: string;
  initialSelectedHandles: readonly string[];
}) {
  const [search, setSearch] = useState("");
  const [selectedHandles, setSelectedHandles] = useState<readonly string[]>(
    input.initialSelectedHandles,
  );

  const visibleItems = filterRepositoryItems(input.items, search);
  const viewModel = buildIntegrationResourceWidgetViewModel({
    title: input.title,
    availableCount: input.items.length,
    refreshLabel: input.refreshLabel,
    syncMetadata: input.syncMetadata,
    syncState: "ready",
    emptyMessage: input.emptyMessage,
    search,
    selectedCount: selectedHandles.length,
    refreshErrorMessage: null,
    unavailableSelectedHandles: [],
    unavailableSelectedHandlesCount: 0,
    listState: {
      mode: "ready",
    },
    visibleItemsCount: visibleItems.length,
  });

  function toggleHandle(handle: string): void {
    setSelectedHandles((current) =>
      current.includes(handle)
        ? current.filter((selectedHandle) => selectedHandle !== handle)
        : [...current, handle],
    );
  }

  return {
    search,
    setSearch,
    selectedHandles,
    toggleHandle,
    visibleItems,
    viewModel,
  };
}
