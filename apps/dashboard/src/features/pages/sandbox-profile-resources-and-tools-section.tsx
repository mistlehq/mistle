import { Checkbox, DetailLabel } from "@mistle/ui";
import { useDebouncedValue } from "@tanstack/react-pacer";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { useState } from "react";

import { resolveApiErrorMessage } from "../api/error-message.js";
import { IntegrationResourcePickerView } from "../forms/integration-resource-picker-view.js";
import {
  listIntegrationConnectionResources,
  refreshIntegrationConnectionResources,
} from "../integrations/integrations-service.js";
import { sandboxProfileIntegrationDirectoryQueryKey } from "../sandbox-profiles/sandbox-profiles-query-keys.js";
import type {
  IntegrationConnectionSummary,
  IntegrationTargetSummary,
  SandboxProfileBindingEditorRow,
} from "./sandbox-profile-binding-config-editor.js";
import {
  resolveBindingConfigSummaryItems,
  resolveBindingToolToggleModel,
} from "./sandbox-profile-binding-config-editor.js";

const SearchDebounceMs = 300;
const SandboxProfileResourcesAndToolsSimpleControlClassName = "flex items-center md:min-h-9";

function resolveRepositorySummary(
  connection: IntegrationConnectionSummary | undefined,
): { count: number; lastSyncedAt?: string; syncState?: string } | null {
  const summary = connection?.resources?.find((resource) => resource.kind === "repository");

  if (summary === undefined) {
    return null;
  }

  return {
    count: summary.count,
    ...(summary.lastSyncedAt === undefined ? {} : { lastSyncedAt: summary.lastSyncedAt }),
    syncState: summary.syncState,
  };
}

function resolveSelectedHandles(row: SandboxProfileBindingEditorRow | null): string[] {
  if (row === null || !Array.isArray(row.config["repositories"])) {
    return [];
  }

  return row.config["repositories"].filter((value): value is string => typeof value === "string");
}

function RepositoryResourcesPicker(input: {
  row: SandboxProfileBindingEditorRow;
  connection: IntegrationConnectionSummary;
  onRowChange: (
    clientId: string,
    changes: Partial<Omit<SandboxProfileBindingEditorRow, "clientId">>,
  ) => void;
  disabled?: boolean | undefined;
  readOnly?: boolean | undefined;
}): React.JSX.Element {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [debouncedSearch] = useDebouncedValue(search, {
    wait: SearchDebounceMs,
  });
  const selectedHandles = resolveSelectedHandles(input.row);
  const repositorySummary = resolveRepositorySummary(input.connection);

  const resourceQuery = useQuery({
    queryKey: [
      "integration-connections",
      input.connection.id,
      "resources",
      "repository",
      debouncedSearch,
    ],
    queryFn: async ({ signal }) =>
      listIntegrationConnectionResources({
        connectionId: input.connection.id,
        kind: "repository",
        ...(debouncedSearch.length === 0 ? {} : { search: debouncedSearch }),
        signal,
      }),
    retry: false,
  });

  const refreshMutation = useMutation({
    mutationFn: async () =>
      refreshIntegrationConnectionResources({
        connectionId: input.connection.id,
        kind: "repository",
      }),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: ["integration-connections", input.connection.id, "resources", "repository"],
        }),
        queryClient.invalidateQueries({
          queryKey: sandboxProfileIntegrationDirectoryQueryKey(),
        }),
      ]);
    },
  });

  const visibleItems = resourceQuery.data?.items ?? [];
  const availableHandles = new Set(visibleItems.map((item) => item.handle));
  const unavailableSelectedHandles =
    resourceQuery.data === undefined || debouncedSearch.length > 0
      ? []
      : selectedHandles.filter((handle) => !availableHandles.has(handle));
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

  function updateSelectedHandles(nextValue: readonly string[]): void {
    if (input.disabled === true) {
      return;
    }

    input.onRowChange(input.row.clientId, {
      config: {
        ...input.row.config,
        repositories: [...nextValue],
      },
    });
  }

  function toggleAll(): void {
    if (input.disabled === true) {
      return;
    }

    const visibleHandleSet = new Set(visibleItems.map((item) => item.handle));
    const allVisibleSelected = visibleItems.every((item) => selectedHandles.includes(item.handle));

    if (allVisibleSelected) {
      updateSelectedHandles(selectedHandles.filter((handle) => !visibleHandleSet.has(handle)));
      return;
    }

    const selectedSet = new Set(selectedHandles);
    const handlesToAdd = visibleItems
      .filter((item) => !selectedSet.has(item.handle))
      .map((item) => item.handle);
    updateSelectedHandles([...selectedHandles, ...handlesToAdd]);
  }

  if (input.readOnly === true) {
    return selectedHandles.length === 0 ? (
      <p className="text-muted-foreground text-sm">No repositories selected.</p>
    ) : (
      <div className="flex flex-wrap gap-1.5">
        {selectedHandles.map((handle) => (
          <span
            className="bg-muted text-foreground inline-flex max-w-full rounded-sm px-1.5 py-1 text-xs font-medium"
            key={handle}
          >
            <span className="truncate">{handle}</span>
          </span>
        ))}
      </div>
    );
  }

  return (
    <IntegrationResourcePickerView
      disabled={input.disabled === true}
      emptyMessage="No repositories available for this connection."
      id={`sandbox-profile-repositories-${input.connection.id}`}
      isRefreshing={refreshMutation.isPending}
      label="Repositories"
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
      onBlur={() => {}}
      onFocus={() => {}}
      onRefresh={() => {
        refreshMutation.mutate();
      }}
      onSearchChange={setSearch}
      onSelectionChange={updateSelectedHandles}
      onToggleAll={toggleAll}
      refreshErrorMessage={refreshErrorMessage}
      refreshLabel="Refresh repositories"
      refreshTooltip={
        repositorySummary?.count === undefined
          ? "Refresh repositories"
          : `Refresh repositories (${String(repositorySummary.count)} available)`
      }
      search={search}
      searchPlaceholder="Add repositories"
      selectedHandles={selectedHandles}
      unavailableSelectedHandles={unavailableSelectedHandles}
      visibleItems={visibleItems}
    />
  );
}

function BindingToolsControl(input: {
  row: SandboxProfileBindingEditorRow;
  availableConnections: readonly IntegrationConnectionSummary[];
  availableTargets: readonly IntegrationTargetSummary[];
  onRowChange: (
    clientId: string,
    changes: Partial<Omit<SandboxProfileBindingEditorRow, "clientId">>,
  ) => void;
  disabled?: boolean | undefined;
  readOnly?: boolean | undefined;
}): ReactNode {
  const toolToggleModel = resolveBindingToolToggleModel({
    row: input.row,
    connections: input.availableConnections,
    targets: input.availableTargets,
  });

  if (toolToggleModel.mode !== "supported") {
    return null;
  }

  return (
    <div className="flex flex-col gap-2">
      {toolToggleModel.options.map((option) => (
        <label className="flex items-center gap-2 text-sm md:min-h-9" key={option.value}>
          <Checkbox
            aria-label={option.label}
            checked={option.checked}
            disabled={input.disabled === true}
            onCheckedChange={(checked) => {
              if (input.disabled === true) {
                return;
              }

              input.onRowChange(input.row.clientId, {
                config: {
                  ...toolToggleModel.config,
                  tools:
                    checked === true
                      ? toolToggleModel.options
                          .filter(
                            (candidate) => candidate.checked || candidate.value === option.value,
                          )
                          .map((candidate) => candidate.value)
                      : toolToggleModel.options
                          .filter(
                            (candidate) => candidate.checked && candidate.value !== option.value,
                          )
                          .map((candidate) => candidate.value),
                },
              });
            }}
          />
          <span>{option.label}</span>
        </label>
      ))}
    </div>
  );
}

export function hasSandboxProfileBindingResourcesAndToolsCellContent(input: {
  row: SandboxProfileBindingEditorRow;
  availableConnections: readonly IntegrationConnectionSummary[];
  availableTargets: readonly IntegrationTargetSummary[];
}): boolean {
  const connection = input.availableConnections.find(
    (candidate) => candidate.id === input.row.connectionId,
  );
  const target =
    connection === undefined
      ? undefined
      : input.availableTargets.find((candidate) => candidate.targetKey === connection.targetKey);

  if (connection === undefined || target === undefined) {
    return true;
  }

  if (input.row.kind === "git") {
    return true;
  }

  const summaryItems = resolveBindingConfigSummaryItems({
    row: input.row,
    connections: input.availableConnections,
    targets: input.availableTargets,
    excludedPropertyKeys: ["repositories", "tools"],
    maxItems: 3,
  });
  const toolToggleModel = resolveBindingToolToggleModel({
    row: input.row,
    connections: input.availableConnections,
    targets: input.availableTargets,
  });

  return summaryItems.length > 0 || toolToggleModel.mode === "supported";
}

export function SandboxProfileBindingResourcesAndToolsCell(input: {
  row: SandboxProfileBindingEditorRow;
  availableConnections: readonly IntegrationConnectionSummary[];
  availableTargets: readonly IntegrationTargetSummary[];
  onRowChange: (
    clientId: string,
    changes: Partial<Omit<SandboxProfileBindingEditorRow, "clientId">>,
  ) => void;
  disabled?: boolean | undefined;
  readOnly?: boolean | undefined;
}): React.JSX.Element {
  const connection = input.availableConnections.find(
    (candidate) => candidate.id === input.row.connectionId,
  );
  const target =
    connection === undefined
      ? undefined
      : input.availableTargets.find((candidate) => candidate.targetKey === connection.targetKey);
  const issue =
    connection === undefined
      ? "missing-connection"
      : target === undefined
        ? "missing-target"
        : null;
  const summaryItems = resolveBindingConfigSummaryItems({
    row: input.row,
    connections: input.availableConnections,
    targets: input.availableTargets,
    excludedPropertyKeys: ["repositories", "tools"],
    maxItems: 3,
  });

  if (issue === "missing-connection") {
    return (
      <div className={SandboxProfileResourcesAndToolsSimpleControlClassName}>
        <p className="text-destructive text-sm">Connection cannot be found.</p>
      </div>
    );
  }

  if (issue === "missing-target") {
    return (
      <div className={SandboxProfileResourcesAndToolsSimpleControlClassName}>
        <p className="text-destructive text-sm">Integration no longer available.</p>
      </div>
    );
  }

  return (
    <div className="flex min-w-0 flex-col gap-3">
      {input.row.kind === "git" && connection !== undefined ? (
        <RepositoryResourcesPicker
          connection={connection}
          disabled={input.disabled}
          readOnly={input.readOnly}
          onRowChange={input.onRowChange}
          row={input.row}
        />
      ) : null}

      {summaryItems.length === 0 ? null : (
        <div className="grid grid-cols-1 gap-2">
          {summaryItems.map((item) => (
            <div className="flex min-w-0 flex-col gap-1" key={item.label}>
              <DetailLabel as="p">{item.label}</DetailLabel>
              <p className="text-sm">{item.value}</p>
            </div>
          ))}
        </div>
      )}

      <BindingToolsControl
        availableConnections={input.availableConnections}
        availableTargets={input.availableTargets}
        disabled={input.disabled}
        readOnly={input.readOnly}
        onRowChange={input.onRowChange}
        row={input.row}
      />
    </div>
  );
}
