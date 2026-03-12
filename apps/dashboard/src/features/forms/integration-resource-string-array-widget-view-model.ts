export type IntegrationResourceListViewState =
  | {
      mode: "loading";
    }
  | {
      mode: "error";
      message: string;
    }
  | {
      mode: "ready";
      items?: readonly unknown[];
    };

export type IntegrationResourceWidgetViewModel = {
  searchPlaceholder: string;
  refreshTooltip: string;
  emptyMessage: string;
  hasVisibleItems: boolean;
  selectedCountLabel: string | null;
  messageSections: IntegrationResourceWidgetMessageSection[];
};

export type IntegrationResourceWidgetMessageSection = {
  tone: "default" | "destructive";
  message: string;
  detail?: string | undefined;
  items?: readonly string[] | undefined;
};

function formatIntegrationResourceSearchPlaceholder(input: {
  title: string | undefined;
  availableCount: number | undefined;
}): string {
  if (input.availableCount === undefined) {
    return `Search ${input.title ?? "resources"}`;
  }

  const pluralLabel = input.title ?? "resources";
  const singularLabel =
    pluralLabel === "Repositories"
      ? "Repository"
      : pluralLabel === "repositories"
        ? "repository"
        : pluralLabel === "Resources"
          ? "Resource"
          : pluralLabel === "resources"
            ? "resource"
            : pluralLabel;
  const resourceLabel = input.availableCount === 1 ? singularLabel : pluralLabel;

  return `Search ${input.availableCount} ${resourceLabel.toLowerCase()}`;
}

function formatIntegrationResourceRefreshTooltip(input: {
  refreshLabel: string;
  syncMetadata: string | null;
}): string {
  return input.syncMetadata === null
    ? input.refreshLabel
    : `${input.refreshLabel}\n${input.syncMetadata}`;
}

function resolveIntegrationResourceEmptyMessage(input: {
  syncState: string | undefined;
  emptyMessage: string | undefined;
  search: string;
}): string {
  if (input.search.trim().length > 0) {
    return "No repositories match this search.";
  }

  if (input.emptyMessage !== undefined) {
    return input.emptyMessage;
  }

  if (input.syncState === "never-synced") {
    return "Connection has not been synced yet. Use refresh to sync.";
  }

  return "No accessible resources found for this connection.";
}

function resolveSelectedCountLabel(selectedCount: number): string | null {
  if (selectedCount === 0) {
    return null;
  }

  return selectedCount === 1 ? "1 selected" : `${String(selectedCount)} selected`;
}

function resolveSyncFailureState(input: {
  listState: IntegrationResourceListViewState;
  hasVisibleItems: boolean;
}): {
  message: string | null;
  detail: string | null;
} {
  if (input.listState.mode !== "error") {
    return {
      message: null,
      detail: null,
    };
  }

  if (input.hasVisibleItems) {
    return {
      message: "Sync failed. Only showing last synced results.",
      detail: "Try again. If this keeps failing, reconnect the integration.",
    };
  }

  return {
    message: "Sync failed.",
    detail: input.listState.message,
  };
}

export function buildIntegrationResourceWidgetViewModel(input: {
  title: string | undefined;
  availableCount: number | undefined;
  refreshLabel: string;
  syncMetadata: string | null;
  syncState: string | undefined;
  emptyMessage: string | undefined;
  search: string;
  selectedCount: number;
  refreshErrorMessage: string | null;
  unavailableSelectedHandles?: readonly string[] | undefined;
  unavailableSelectedHandlesCount: number;
  listState: IntegrationResourceListViewState;
  visibleItemsCount: number;
}): IntegrationResourceWidgetViewModel {
  const hasVisibleItems = input.visibleItemsCount > 0;
  const syncFailureState = resolveSyncFailureState({
    listState: input.listState,
    hasVisibleItems,
  });
  const emptyMessage = resolveIntegrationResourceEmptyMessage({
    syncState: input.syncState,
    emptyMessage: input.emptyMessage,
    search: input.search,
  });
  const messageSections: IntegrationResourceWidgetMessageSection[] = [];

  if (input.refreshErrorMessage !== null) {
    messageSections.push({
      tone: "destructive",
      message: "Refresh failed.",
      detail: "Please try again.",
    });
  }

  if (input.unavailableSelectedHandlesCount > 0 && input.unavailableSelectedHandles) {
    messageSections.push({
      tone: "destructive",
      message: "The selected resources are no longer available:",
      items: input.unavailableSelectedHandles,
    });
  }

  if (syncFailureState.message !== null) {
    messageSections.push({
      tone: "destructive",
      message: syncFailureState.message,
      ...(syncFailureState.detail === null ? {} : { detail: syncFailureState.detail }),
    });
  } else if (!hasVisibleItems && input.listState.mode !== "loading") {
    messageSections.push({
      tone: "default",
      message: emptyMessage,
    });
  }

  return {
    searchPlaceholder: formatIntegrationResourceSearchPlaceholder({
      title: input.title,
      availableCount: input.availableCount,
    }),
    refreshTooltip: formatIntegrationResourceRefreshTooltip({
      refreshLabel: input.refreshLabel,
      syncMetadata: input.syncMetadata,
    }),
    emptyMessage,
    hasVisibleItems,
    selectedCountLabel: resolveSelectedCountLabel(input.selectedCount),
    messageSections,
  };
}
