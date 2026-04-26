import { Checkbox, DetailLabel } from "@mistle/ui";
import { useDebouncedValue } from "@tanstack/react-pacer";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import { resolveApiErrorMessage } from "../api/error-message.js";
import { IntegrationResourcePickerView } from "../forms/integration-resource-picker-view.js";
import {
  listIntegrationConnectionResources,
  refreshIntegrationConnectionResources,
} from "../integrations/integrations-service.js";
import { resolveIntegrationLogoPath } from "../integrations/logo.js";
import { sandboxProfileIntegrationDirectoryQueryKey } from "../sandbox-profiles/sandbox-profiles-query-keys.js";
import {
  ResponsiveFieldList,
  ResponsiveFieldListCell,
  type ResponsiveFieldListColumn,
  ResponsiveFieldListRow,
} from "../shared/responsive-field-list.js";
import type {
  IntegrationConnectionSummary,
  IntegrationTargetSummary,
  SandboxProfileBindingEditorRow,
} from "./sandbox-profile-binding-config-editor.js";
import {
  resolveBindingConfigSummaryItems,
  resolveBindingToolToggleModel,
} from "./sandbox-profile-binding-config-editor.js";
import { resolveRowBindingMetadata } from "./sandbox-profile-binding-shared.js";

const SearchDebounceMs = 300;

const ToolBindingsColumns = [
  { key: "integration", label: "Integration", desktopWidth: "minmax(0,12rem)" },
  { key: "tools", label: "Tools", desktopWidth: "minmax(0,1fr)" },
  {
    key: "actions",
    label: <span className="sr-only">Actions</span>,
    desktopWidth: "auto",
    align: "end",
    hideMobileLabel: true,
  },
] satisfies readonly ResponsiveFieldListColumn[];

function resolveGitBindingRow(
  rows: readonly SandboxProfileBindingEditorRow[],
): SandboxProfileBindingEditorRow | null {
  return rows.find((row) => row.kind === "git") ?? null;
}

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

  if (input.disabled === true) {
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

function ToolBindingsSection(input: {
  rows: readonly SandboxProfileBindingEditorRow[];
  availableConnections: readonly IntegrationConnectionSummary[];
  availableTargets: readonly IntegrationTargetSummary[];
  onRowChange: (
    clientId: string,
    changes: Partial<Omit<SandboxProfileBindingEditorRow, "clientId">>,
  ) => void;
  disabled?: boolean | undefined;
}): React.JSX.Element {
  const toolRows = input.rows.filter((row) => {
    const toolToggleModel = resolveBindingToolToggleModel({
      row,
      connections: input.availableConnections,
      targets: input.availableTargets,
    });

    return toolToggleModel.mode === "supported";
  });

  if (toolRows.length === 0) {
    return (
      <p className="text-muted-foreground text-sm">
        Choose integrations with CLI tools in Integrations before selecting tools here.
      </p>
    );
  }

  return (
    <ResponsiveFieldList columns={ToolBindingsColumns}>
      {toolRows.map((row) => {
        const toolToggleModel = resolveBindingToolToggleModel({
          row,
          connections: input.availableConnections,
          targets: input.availableTargets,
        });
        const rowMetadata = resolveRowBindingMetadata({
          row,
          availableConnections: input.availableConnections,
          availableTargets: input.availableTargets,
        });
        const summaryItems = resolveBindingConfigSummaryItems({
          row,
          connections: input.availableConnections,
          targets: input.availableTargets,
          excludedPropertyKeys: ["tools", "repositories"],
          maxItems: 3,
        });

        if (toolToggleModel.mode !== "supported") {
          return null;
        }

        return (
          <ResponsiveFieldListRow className="py-4" key={row.clientId}>
            <ResponsiveFieldListCell columnKey="integration">
              <div className="flex items-center gap-2 text-sm">
                {rowMetadata?.target?.logoKey === undefined ? null : (
                  <img
                    alt=""
                    className="h-5 w-5 rounded-sm"
                    src={resolveIntegrationLogoPath({ logoKey: rowMetadata.target.logoKey })}
                  />
                )}
                <div className="min-w-0 truncate font-medium">
                  {rowMetadata?.target?.displayName ?? "Integration"}
                </div>
              </div>
            </ResponsiveFieldListCell>
            <ResponsiveFieldListCell columnKey="tools">
              <div className="flex flex-col gap-2">
                {summaryItems.length === 0 ? null : (
                  <div className="mb-1 flex flex-col gap-2">
                    {summaryItems.map((item) => (
                      <div className="flex min-w-0 flex-col gap-0.5" key={item.label}>
                        <DetailLabel as="p">{item.label}</DetailLabel>
                        <p className="text-sm">{item.value}</p>
                      </div>
                    ))}
                  </div>
                )}
                {toolToggleModel.options.map((option) => (
                  <label className="flex items-center gap-2 text-sm" key={option.value}>
                    <Checkbox
                      aria-label={option.label}
                      checked={option.checked}
                      disabled={input.disabled === true}
                      onCheckedChange={(checked) => {
                        if (input.disabled === true) {
                          return;
                        }

                        input.onRowChange(row.clientId, {
                          config: {
                            ...toolToggleModel.config,
                            tools:
                              checked === true
                                ? toolToggleModel.options
                                    .filter(
                                      (candidate) =>
                                        candidate.checked || candidate.value === option.value,
                                    )
                                    .map((candidate) => candidate.value)
                                : toolToggleModel.options
                                    .filter(
                                      (candidate) =>
                                        candidate.checked && candidate.value !== option.value,
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
            </ResponsiveFieldListCell>
            <ResponsiveFieldListCell columnKey="actions" />
          </ResponsiveFieldListRow>
        );
      })}
    </ResponsiveFieldList>
  );
}

export function SandboxProfileResourcesAndToolsSection(input: {
  rows: readonly SandboxProfileBindingEditorRow[];
  availableConnections: readonly IntegrationConnectionSummary[];
  availableTargets: readonly IntegrationTargetSummary[];
  onRowChange: (
    clientId: string,
    changes: Partial<Omit<SandboxProfileBindingEditorRow, "clientId">>,
  ) => void;
  disabled?: boolean | undefined;
}): React.JSX.Element {
  const gitRow = resolveGitBindingRow(input.rows);
  const gitConnection =
    gitRow === null
      ? undefined
      : input.availableConnections.find((connection) => connection.id === gitRow.connectionId);
  const gitTarget =
    gitConnection === undefined
      ? undefined
      : input.availableTargets.find((target) => target.targetKey === gitConnection.targetKey);
  const gitIssue =
    gitRow === null
      ? null
      : gitConnection === undefined
        ? "missing-connection"
        : gitTarget === undefined
          ? "missing-target"
          : null;
  const gitSummaryItems =
    gitRow === null
      ? []
      : resolveBindingConfigSummaryItems({
          row: gitRow,
          connections: input.availableConnections,
          targets: input.availableTargets,
          excludedPropertyKeys: ["repositories", "tools"],
        });

  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-col gap-3">
        <DetailLabel as="p">Repository Resources</DetailLabel>
        {gitIssue !== null ? (
          <p className="text-destructive text-sm">
            Fix the Git provider in Integrations before selecting repository resources.
          </p>
        ) : gitRow === null || gitConnection === undefined ? (
          <p className="text-muted-foreground text-sm">
            Choose a Git provider in Integrations before selecting repository resources.
          </p>
        ) : (
          <div className="flex flex-col gap-3">
            <RepositoryResourcesPicker
              connection={gitConnection}
              disabled={input.disabled}
              onRowChange={input.onRowChange}
              row={gitRow}
            />
            {gitSummaryItems.length === 0 ? null : (
              <div className="grid grid-cols-1 gap-2 md:grid-cols-2 xl:grid-cols-3">
                {gitSummaryItems.map((item) => (
                  <div className="flex flex-col gap-1" key={item.label}>
                    <DetailLabel as="p">{item.label}</DetailLabel>
                    <p className="text-sm">{item.value}</p>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      <div className="flex flex-col gap-3">
        <ToolBindingsSection
          availableConnections={input.availableConnections}
          availableTargets={input.availableTargets}
          disabled={input.disabled}
          onRowChange={input.onRowChange}
          rows={input.rows}
        />
      </div>
    </div>
  );
}
