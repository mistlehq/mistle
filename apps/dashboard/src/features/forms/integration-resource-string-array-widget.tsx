import { Input } from "@mistle/ui";
import type { RJSFSchema, WidgetProps } from "@rjsf/utils";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useDeferredValue, useState } from "react";
import { z } from "zod";

import { resolveApiErrorMessage } from "../api/error-message.js";
import {
  type IntegrationConnectionResourceSummary,
  listIntegrationConnectionResources,
  refreshIntegrationConnectionResources,
} from "../integrations/integrations-service.js";
import { formatDateTime } from "../shared/date-formatters.js";
import { isRecord } from "../shared/is-record.js";
import type { IntegrationFormContext } from "./integration-form-context.js";
import { buildIntegrationResourceWidgetViewModel } from "./integration-resource-string-array-widget-view-model.js";
import { IntegrationResourceStringArrayWidgetView } from "./integration-resource-string-array-widget-view.js";

type JsonObject = Record<string, unknown>;
const IntegrationResourceSummaryOptionSchema = z
  .object({
    kind: z.string().min(1),
    selectionMode: z.enum(["single", "multi"]),
    count: z.number().int().min(0),
    syncState: z.enum(["never-synced", "syncing", "ready", "error"]),
    lastSyncedAt: z.string().min(1).optional(),
  })
  .strict();

const IntegrationResourceStringArrayWidgetOptionsSchema = z
  .object({
    connectionId: z.string().min(1),
    kind: z.string().min(1),
    title: z.string().min(1).optional(),
    searchPlaceholder: z.string().min(1).optional(),
    emptyMessage: z.string().min(1).optional(),
    refreshLabel: z.string().min(1).optional(),
    resourceSummary: IntegrationResourceSummaryOptionSchema.optional(),
  })
  .passthrough();

type IntegrationResourceStringArrayWidgetOptions = z.infer<
  typeof IntegrationResourceStringArrayWidgetOptionsSchema
>;

function resolveWidgetOptions(
  options: WidgetProps<JsonObject, RJSFSchema, IntegrationFormContext>["options"],
): IntegrationResourceStringArrayWidgetOptions {
  const parsedOptions = IntegrationResourceStringArrayWidgetOptionsSchema.safeParse(options);
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
  const widgetViewModel = buildIntegrationResourceWidgetViewModel({
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
    listState:
      resourceOverride !== undefined
        ? {
            mode: "ready",
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
              },
    visibleItemsCount: visibleItems.length,
  });

  return (
    <IntegrationResourceStringArrayWidgetView
      emptyMessage={widgetViewModel.emptyMessage}
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
      refreshTooltip={widgetViewModel.refreshTooltip}
      search={search}
      searchPlaceholder={widgetViewModel.searchPlaceholder}
      selectedHandles={selectedHandles}
      unavailableSelectedHandles={unavailableSelectedHandles}
      visibleItems={visibleItems}
    />
  );
}
