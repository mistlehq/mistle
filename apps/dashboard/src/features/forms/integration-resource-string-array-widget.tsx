import { Alert, AlertDescription, Badge, Button, Input, ScrollArea } from "@mistle/ui";
import type { RJSFSchema, WidgetProps } from "@rjsf/utils";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useDeferredValue, useState } from "react";

import { resolveApiErrorMessage } from "../api/error-message.js";
import {
  type IntegrationConnectionResourceSummary,
  listIntegrationConnectionResources,
  refreshIntegrationConnectionResources,
} from "../integrations/integrations-service.js";

type JsonObject = Record<string, unknown>;
type IntegrationFormContext = {
  layout?: "vertical" | "horizontal";
};

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

function formatSyncStateLabel(syncState: string): string {
  switch (syncState) {
    case "never-synced":
      return "Never synced";
    case "syncing":
      return "Syncing";
    case "error":
      return "Sync failed";
    default:
      return "Ready";
  }
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

function IntegrationResourceListError(input: {
  error: unknown;
  onRefresh: () => void;
  isRefreshing: boolean;
  refreshLabel: string;
}): React.JSX.Element {
  const message = resolveApiErrorMessage({
    error: input.error,
    fallbackMessage: "Could not load resources for this connection.",
  });

  return (
    <Alert variant="destructive">
      <AlertDescription className="gap-3 flex flex-col">
        <span>{message}</span>
        <div>
          <Button
            disabled={input.isRefreshing}
            onClick={input.onRefresh}
            size="sm"
            type="button"
            variant="outline"
          >
            {input.isRefreshing ? "Refreshing..." : input.refreshLabel}
          </Button>
        </div>
      </AlertDescription>
    </Alert>
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

  const availableHandles = new Set(resourceQuery.data?.items.map((item) => item.handle) ?? []);
  const unavailableSelectedHandles =
    resourceQuery.data === undefined || deferredSearch.length > 0
      ? []
      : selectedHandles.filter((handle) => !availableHandles.has(handle));

  function toggleHandle(handle: string): void {
    const nextSelection = selectedHandles.includes(handle)
      ? selectedHandles.filter((selectedHandle) => selectedHandle !== handle)
      : [...selectedHandles, handle];
    props.onChange(nextSelection);
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
  const refreshErrorMessage =
    refreshMutation.error === null || refreshMutation.error === undefined
      ? null
      : resolveApiErrorMessage({
          error: refreshMutation.error,
          fallbackMessage: "Could not refresh resources for this connection.",
        });

  return (
    <div className="gap-3 flex flex-col">
      <div className="gap-2 flex items-center">
        <Input
          aria-label={props.label}
          className="w-full"
          id={props.id}
          onBlur={() => {
            props.onBlur(props.id, selectedHandles);
          }}
          onChange={(event) => {
            setSearch(event.currentTarget.value);
          }}
          onFocus={() => {
            props.onFocus(props.id, selectedHandles);
          }}
          placeholder={options.searchPlaceholder ?? `Search ${options.title ?? "resources"}`}
          value={search}
        />
        <Button
          disabled={refreshMutation.isPending}
          onClick={triggerRefresh}
          size="sm"
          type="button"
          variant="outline"
        >
          {refreshMutation.isPending ? "Refreshing..." : refreshLabel}
        </Button>
      </div>

      <div className="gap-2 flex flex-wrap items-center">
        {syncState === undefined ? null : (
          <Badge variant="secondary">{formatSyncStateLabel(syncState)}</Badge>
        )}
        {syncMetadata === null ? null : (
          <span className="text-muted-foreground text-xs">{syncMetadata}</span>
        )}
        {options.resourceSummary === undefined ? null : (
          <span className="text-muted-foreground text-xs">
            {options.resourceSummary.count} available
          </span>
        )}
      </div>

      {refreshErrorMessage === null ? null : (
        <Alert variant="destructive">
          <AlertDescription>{refreshErrorMessage}</AlertDescription>
        </Alert>
      )}

      {unavailableSelectedHandles.length === 0 ? null : (
        <Alert variant="destructive">
          <AlertDescription>
            Selected resources are no longer accessible on this connection:{" "}
            {unavailableSelectedHandles.join(", ")}
          </AlertDescription>
        </Alert>
      )}

      {selectedHandles.length === 0 ? null : (
        <div className="gap-2 flex flex-wrap">
          {selectedHandles.map((handle) => (
            <Badge key={handle} variant="outline">
              {handle}
            </Badge>
          ))}
        </div>
      )}

      {resourceQuery.isPending ? (
        <div className="border rounded-md p-3 text-sm">Loading resources...</div>
      ) : resourceQuery.isError ? (
        <IntegrationResourceListError
          error={resourceQuery.error}
          isRefreshing={refreshMutation.isPending}
          onRefresh={triggerRefresh}
          refreshLabel={refreshLabel}
        />
      ) : (
        <ScrollArea className="h-56 border rounded-md">
          <div className="divide-y">
            {resourceQuery.data.items.length === 0 ? (
              <p className="text-muted-foreground p-3 text-sm">
                {options.emptyMessage ?? "No accessible resources found for this connection."}
              </p>
            ) : (
              resourceQuery.data.items.map((resource) => {
                const isSelected = selectedHandles.includes(resource.handle);

                return (
                  <label
                    className="hover:bg-muted/40 gap-3 flex cursor-pointer items-start p-3"
                    key={resource.id}
                  >
                    <input
                      checked={isSelected}
                      className="mt-0.5"
                      onChange={() => {
                        toggleHandle(resource.handle);
                      }}
                      type="checkbox"
                    />
                    <div className="min-w-0 flex-1">
                      <div className="font-medium text-sm">{resource.displayName}</div>
                      <div className="text-muted-foreground truncate text-xs">
                        {resource.handle}
                      </div>
                    </div>
                  </label>
                );
              })
            )}
          </div>
        </ScrollArea>
      )}
    </div>
  );
}
