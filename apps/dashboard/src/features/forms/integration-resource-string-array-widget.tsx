import { Input } from "@mistle/ui";
import type { RJSFSchema, WidgetProps } from "@rjsf/utils";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useDeferredValue, useState } from "react";

import { resolveApiErrorMessage } from "../api/error-message.js";
import {
  type IntegrationConnectionResourceSummary,
  listIntegrationConnectionResources,
  refreshIntegrationConnectionResources,
} from "../integrations/integrations-service.js";
import { formatDateTime } from "../shared/date-formatters.js";
import type { IntegrationFormContext } from "./integration-form-context.js";
import { IntegrationResourceStringArrayWidgetView } from "./integration-resource-string-array-widget-view.js";

type JsonObject = Record<string, unknown>;

type IntegrationResourceStringArrayWidgetOptions = {
  connectionId: string;
  kind: string;
  title?: string | undefined;
  searchPlaceholder?: string | undefined;
  emptyMessage?: string | undefined;
  refreshLabel?: string | undefined;
  resourceSummary?: IntegrationConnectionResourceSummary | undefined;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readStringOption(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function resolveResourceSummary(value: unknown): IntegrationConnectionResourceSummary | undefined {
  if (!isRecord(value)) {
    return undefined;
  }

  if (
    value.selectionMode !== "single" &&
    value.selectionMode !== "multi" &&
    value.selectionMode !== undefined
  ) {
    throw new Error("Integration resource widget received an invalid resource summary.");
  }

  if (
    value.syncState !== "never-synced" &&
    value.syncState !== "syncing" &&
    value.syncState !== "ready" &&
    value.syncState !== "error" &&
    value.syncState !== undefined
  ) {
    throw new Error("Integration resource widget received an invalid resource summary.");
  }

  const kind = readStringOption(value.kind);
  const selectionMode = value.selectionMode;
  const syncState = value.syncState;
  const count = typeof value.count === "number" && Number.isInteger(value.count) ? value.count : 0;
  if (kind === undefined || selectionMode === undefined || syncState === undefined) {
    throw new Error("Integration resource widget received an incomplete resource summary.");
  }

  return {
    kind,
    selectionMode,
    count,
    syncState,
    ...(readStringOption(value.lastSyncedAt) === undefined
      ? {}
      : { lastSyncedAt: readStringOption(value.lastSyncedAt) }),
  };
}

function resolveWidgetOptions(
  options: WidgetProps<JsonObject, RJSFSchema, IntegrationFormContext>["options"],
): IntegrationResourceStringArrayWidgetOptions {
  if (!isRecord(options)) {
    throw new Error("Integration resource widget options must be an object.");
  }

  const connectionId = readStringOption(options.connectionId);
  if (connectionId === undefined) {
    throw new Error("Integration resource widget requires a connectionId option.");
  }

  const kind = readStringOption(options.kind);
  if (kind === undefined) {
    throw new Error("Integration resource widget requires a kind option.");
  }

  const resourceSummary = resolveResourceSummary(options.resourceSummary);
  if (resourceSummary?.selectionMode === "single") {
    throw new Error("Integration resource widget currently supports only multi selection.");
  }

  return {
    connectionId,
    kind,
    ...(readStringOption(options.title) === undefined
      ? {}
      : { title: readStringOption(options.title) }),
    ...(readStringOption(options.searchPlaceholder) === undefined
      ? {}
      : { searchPlaceholder: readStringOption(options.searchPlaceholder) }),
    ...(readStringOption(options.emptyMessage) === undefined
      ? {}
      : { emptyMessage: readStringOption(options.emptyMessage) }),
    ...(readStringOption(options.refreshLabel) === undefined
      ? {}
      : { refreshLabel: readStringOption(options.refreshLabel) }),
    ...(resourceSummary === undefined ? {} : { resourceSummary }),
  };
}

function resolveSelectedHandles(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.filter((entry): entry is string => typeof entry === "string");
}

function formatSyncMetadata(input: {
  syncState: string;
  lastSyncedAt?: string;
  lastErrorMessage?: string;
}): string | null {
  if (input.syncState === "error" && input.lastErrorMessage !== undefined) {
    return input.lastErrorMessage;
  }

  if (input.lastSyncedAt === undefined) {
    return null;
  }

  return `Last synced ${input.lastSyncedAt}`;
}

function formatSearchPlaceholder(input: {
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

function formatRefreshTooltip(input: {
  refreshLabel: string;
  syncMetadata: string | null;
}): string {
  return input.syncMetadata === null
    ? input.refreshLabel
    : `${input.refreshLabel}\n${input.syncMetadata}`;
}

function resolveEmptyMessage(input: {
  syncState: string | undefined;
  emptyMessage: string | undefined;
}): string {
  if (input.emptyMessage !== undefined) {
    return input.emptyMessage;
  }

  if (input.syncState === "never-synced") {
    return "Connection has not been synced yet. Use refresh to sync.";
  }

  return "No accessible resources found for this connection.";
}

function resolveResourceOverride(input: {
  formContext: IntegrationFormContext | undefined;
  connectionId: string;
  kind: string;
}) {
  return input.formContext?.resourceOverrides?.find(
    (override) => override.connectionId === input.connectionId && override.kind === input.kind,
  );
}

export function IntegrationResourceStringArrayWidget(
  props: WidgetProps<JsonObject, RJSFSchema, IntegrationFormContext>,
): React.JSX.Element {
  const options = resolveWidgetOptions(props.options);
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const deferredSearch = useDeferredValue(search);
  const selectedHandles = resolveSelectedHandles(props.value);
  const resourceOverride = resolveResourceOverride({
    formContext: props.registry.formContext,
    connectionId: options.connectionId,
    kind: options.kind,
  });

  const resourceQuery = useQuery({
    queryKey: [
      "integration-connections",
      options.connectionId,
      "resources",
      options.kind,
      deferredSearch,
    ],
    queryFn: async ({ signal }) =>
      listIntegrationConnectionResources({
        connectionId: options.connectionId,
        kind: options.kind,
        ...(deferredSearch.length === 0 ? {} : { search: deferredSearch }),
        signal,
      }),
    enabled: resourceOverride === undefined,
    retry: false,
  });

  const refreshMutation = useMutation({
    mutationFn: async () =>
      refreshIntegrationConnectionResources({
        connectionId: options.connectionId,
        kind: options.kind,
      }),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: ["integration-connections", options.connectionId, "resources", options.kind],
        }),
        queryClient.invalidateQueries({
          queryKey: ["sandbox-profiles", "integration-directory"],
        }),
      ]);
    },
  });

  if (props.disabled || props.readonly) {
    return <Input disabled id={props.id} value={selectedHandles.join(", ")} />;
  }

  const visibleItems =
    resourceOverride === undefined
      ? (resourceQuery.data?.items ?? [])
      : resourceOverride.items.filter((item) =>
          item.handle.toLowerCase().includes(deferredSearch.trim().toLowerCase()),
        );
  const availableHandles = new Set(visibleItems.map((item) => item.handle));
  const unavailableSelectedHandles =
    (resourceOverride === undefined && resourceQuery.data === undefined) ||
    deferredSearch.length > 0
      ? []
      : selectedHandles.filter((handle) => !availableHandles.has(handle));

  function toggleHandle(handle: string): void {
    const nextSelection = selectedHandles.includes(handle)
      ? selectedHandles.filter((selectedHandle) => selectedHandle !== handle)
      : [...selectedHandles, handle];
    props.onChange(nextSelection);
  }

  function triggerRefresh(): void {
    if (resourceOverride !== undefined) {
      return;
    }

    refreshMutation.mutate();
  }

  const refreshLabel = options.refreshLabel ?? `Refresh ${options.title ?? "resources"}`;
  const syncState =
    resourceOverride?.syncState ??
    resourceQuery.data?.syncState ??
    options.resourceSummary?.syncState;
  const syncMetadata =
    resourceOverride !== undefined
      ? formatSyncMetadata({
          syncState: resourceOverride.syncState,
          ...(resourceOverride.lastSyncedAt === undefined
            ? {}
            : { lastSyncedAt: resourceOverride.lastSyncedAt }),
          ...(resourceOverride.lastErrorMessage === undefined
            ? {}
            : { lastErrorMessage: resourceOverride.lastErrorMessage }),
        })
      : resourceQuery.data === undefined
        ? options.resourceSummary === undefined
          ? null
          : formatSyncMetadata({
              syncState: options.resourceSummary.syncState,
              ...(options.resourceSummary.lastSyncedAt === undefined
                ? {}
                : { lastSyncedAt: options.resourceSummary.lastSyncedAt }),
            })
        : formatSyncMetadata({
            syncState: resourceQuery.data.syncState,
            ...(resourceQuery.data.lastSyncedAt === undefined
              ? {}
              : { lastSyncedAt: resourceQuery.data.lastSyncedAt }),
            ...(resourceQuery.data.lastErrorMessage === undefined
              ? {}
              : { lastErrorMessage: resourceQuery.data.lastErrorMessage }),
          });
  const formattedSyncMetadata =
    syncMetadata === null
      ? null
      : syncMetadata.startsWith("Last synced ")
        ? `Last synced ${formatDateTime(syncMetadata.slice("Last synced ".length))}`
        : syncMetadata;
  const refreshErrorMessage =
    resourceOverride !== undefined ||
    refreshMutation.error === null ||
    refreshMutation.error === undefined
      ? null
      : resolveApiErrorMessage({
          error: refreshMutation.error,
          fallbackMessage: "Could not refresh resources for this connection.",
        });
  const resourceListErrorMessage = !resourceQuery.isError
    ? null
    : resolveApiErrorMessage({
        error: resourceQuery.error,
        fallbackMessage: "Could not load resources for this connection.",
      });
  const availableCount =
    resourceOverride?.items.length ??
    resourceQuery.data?.items.length ??
    options.resourceSummary?.count;
  const searchPlaceholder =
    options.searchPlaceholder ?? formatSearchPlaceholder({ title: options.title, availableCount });
  const emptyMessage = resolveEmptyMessage({
    syncState,
    emptyMessage: options.emptyMessage,
  });
  const refreshTooltip = formatRefreshTooltip({
    refreshLabel,
    syncMetadata: formattedSyncMetadata,
  });

  return (
    <IntegrationResourceStringArrayWidgetView
      emptyMessage={emptyMessage}
      id={props.id}
      isRefreshing={refreshMutation.isPending}
      label={props.label}
      listState={
        resourceOverride !== undefined
          ? {
              mode: "ready",
              items: visibleItems,
            }
          : resourceQuery.isPending
            ? {
                mode: "loading",
              }
            : resourceQuery.isError
              ? {
                  mode: "error",
                  message:
                    resourceListErrorMessage ?? "Could not load resources for this connection.",
                }
              : {
                  mode: "ready",
                  items: resourceQuery.data.items,
                }
      }
      onBlur={() => {
        props.onBlur(props.id, selectedHandles);
      }}
      onFocus={() => {
        props.onFocus(props.id, selectedHandles);
      }}
      onRefresh={triggerRefresh}
      onSearchChange={setSearch}
      onToggleHandle={toggleHandle}
      refreshErrorMessage={refreshErrorMessage}
      refreshLabel={refreshLabel}
      refreshTooltip={refreshTooltip}
      search={search}
      searchPlaceholder={searchPlaceholder}
      selectedHandles={selectedHandles}
      unavailableSelectedHandles={unavailableSelectedHandles}
      visibleItems={visibleItems}
    />
  );
}
