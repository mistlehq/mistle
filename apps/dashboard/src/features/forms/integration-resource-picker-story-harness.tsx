import { useState } from "react";

import type { IntegrationConnectionResource } from "../integrations/integrations-service.js";
import { filterRepositoryItems } from "./integration-resource-picker-story-support.js";
import { buildIntegrationResourcePickerViewModel } from "./integration-resource-picker-view-model.js";

export function useIntegrationResourcePickerStoryState(input: {
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
  const viewModel = buildIntegrationResourcePickerViewModel({
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
    listState: {
      mode: "ready",
    },
    visibleItemsCount: visibleItems.length,
  });

  return {
    search,
    setSearch,
    selectedHandles,
    setSelectedHandles,
    visibleItems,
    viewModel,
  };
}
