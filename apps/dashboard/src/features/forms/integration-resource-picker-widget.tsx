import { Input } from "@mistle/ui";
import type { RJSFSchema, WidgetProps } from "@rjsf/utils";
import { useDebouncedValue } from "@tanstack/react-pacer";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { z } from "zod";

import { resolveApiErrorMessage } from "../api/error-message.js";
import {
  listIntegrationConnectionResources,
  refreshIntegrationConnectionResources,
} from "../integrations/integrations-service.js";
import { formatDateTime } from "../shared/date-formatters.js";
import { buildIntegrationResourcePickerViewModel } from "./integration-resource-picker-view-model.js";
import { IntegrationResourcePickerView } from "./integration-resource-picker-view.js";
import type { SchemaFormContext } from "./schema-form.js";

type JsonObject = Record<string, unknown>;
const SearchDebounceMs = 300;
const IntegrationResourceSummaryOptionSchema = z
  .object({
    kind: z.string().min(1),
    selectionMode: z.enum(["single", "multi"]),
    count: z.number().int().min(0),
    syncState: z.enum(["never-synced", "syncing", "ready", "error"]),
    lastSyncedAt: z.string().min(1).optional(),
  })
  .strict();

const IntegrationResourcePickerWidgetOptionsSchema = z
  .object({
    connectionId: z.string().min(1),
    kind: z.string().min(1),
    title: z.string().min(1).optional(),
    searchPlaceholder: z.string().min(1).optional(),
    emptyMessage: z.string().min(1).optional(),
    refreshLabel: z.string().min(1).optional(),
    resourceSummary: IntegrationResourceSummaryOptionSchema.optional(),
  })
  .loose();

type IntegrationResourcePickerWidgetOptions = z.infer<
  typeof IntegrationResourcePickerWidgetOptionsSchema
>;

function resolveWidgetOptions(
  options: WidgetProps<JsonObject, RJSFSchema, SchemaFormContext>["options"],
): IntegrationResourcePickerWidgetOptions {
  const parsedOptions = IntegrationResourcePickerWidgetOptionsSchema.safeParse(options);
  if (!parsedOptions.success) {
    throw new Error("Integration resource widget received invalid options.");
  }

  const resourceSummary = parsedOptions.data.resourceSummary;
  if (resourceSummary?.selectionMode === "single") {
    throw new Error("Integration resource widget currently supports only multi selection.");
  }

  return parsedOptions.data;
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

export function IntegrationResourcePickerWidget(
  props: WidgetProps<JsonObject, RJSFSchema, SchemaFormContext>,
): React.JSX.Element {
  const options = resolveWidgetOptions(props.options);
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [debouncedSearch] = useDebouncedValue(search, {
    wait: SearchDebounceMs,
  });
  const selectedHandles = resolveSelectedHandles(props.value);

  const resourceQuery = useQuery({
    queryKey: [
      "integration-connections",
      options.connectionId,
      "resources",
      options.kind,
      debouncedSearch,
    ],
    queryFn: async ({ signal }) =>
      listIntegrationConnectionResources({
        connectionId: options.connectionId,
        kind: options.kind,
        ...(debouncedSearch.length === 0 ? {} : { search: debouncedSearch }),
        signal,
      }),
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

  const visibleItems = resourceQuery.data?.items ?? [];
  const availableHandles = new Set(visibleItems.map((item) => item.handle));
  const unavailableSelectedHandles =
    resourceQuery.data === undefined || debouncedSearch.length > 0
      ? []
      : selectedHandles.filter((handle) => !availableHandles.has(handle));

  function toggleAll(): void {
    const visibleHandleSet = new Set(visibleItems.map((item) => item.handle));
    const allVisibleSelected = visibleItems.every((item) => selectedHandles.includes(item.handle));

    if (allVisibleSelected) {
      props.onChange(selectedHandles.filter((handle) => !visibleHandleSet.has(handle)));
    } else {
      const selectedSet = new Set(selectedHandles);
      const handlesToAdd = visibleItems
        .filter((item) => !selectedSet.has(item.handle))
        .map((item) => item.handle);
      props.onChange([...selectedHandles, ...handlesToAdd]);
    }
  }

  function triggerRefresh(): void {
    refreshMutation.mutate();
  }

  const refreshLabel = options.refreshLabel ?? `Refresh ${options.title ?? "resources"}`;
  const syncState = resourceQuery.data?.syncState ?? options.resourceSummary?.syncState;
  const syncMetadata =
    resourceQuery.data === undefined
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
    refreshMutation.error === null || refreshMutation.error === undefined
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
  const availableCount = resourceQuery.data?.items.length ?? options.resourceSummary?.count;
  const widgetViewModel = buildIntegrationResourcePickerViewModel({
    title: options.title,
    availableCount,
    refreshLabel,
    syncMetadata: formattedSyncMetadata,
    syncState,
    emptyMessage: options.emptyMessage,
    search,
    selectedCount: selectedHandles.length,
    refreshErrorMessage,
    unavailableSelectedHandles,
    unavailableSelectedHandlesCount: unavailableSelectedHandles.length,
    listState: resourceQuery.isPending
      ? {
          mode: "loading",
        }
      : resourceQuery.isError
        ? {
            mode: "error",
            message: resourceListErrorMessage ?? "Could not load resources for this connection.",
          }
        : {
            mode: "ready",
          },
    visibleItemsCount: visibleItems.length,
  });

  return (
    <IntegrationResourcePickerView
      emptyMessage={widgetViewModel.emptyMessage}
      id={props.id}
      isRefreshing={refreshMutation.isPending}
      label={props.label}
      listState={
        resourceQuery.isPending
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
      onSelectionChange={props.onChange}
      onSearchChange={setSearch}
      onToggleAll={toggleAll}
      refreshErrorMessage={refreshErrorMessage}
      refreshLabel={refreshLabel}
      refreshTooltip={widgetViewModel.refreshTooltip}
      search={search}
      searchPlaceholder={widgetViewModel.searchPlaceholder}
      selectedHandles={selectedHandles}
      unavailableSelectedHandles={unavailableSelectedHandles}
      visibleItems={visibleItems}
    />
  );
}
