import { Button, Input, ScrollArea } from "@mistle/ui";
import { ArrowClockwiseIcon } from "@phosphor-icons/react";

import type { IntegrationConnectionResource } from "../integrations/integrations-service.js";
import {
  buildIntegrationResourceWidgetViewModel,
  type IntegrationResourceListViewState,
} from "./integration-resource-string-array-widget-view-model.js";

export type IntegrationResourceStringArrayWidgetViewProps = {
  id: string;
  label: string;
  search: string;
  searchPlaceholder: string;
  refreshLabel: string;
  refreshTooltip: string;
  selectedHandles: readonly string[];
  unavailableSelectedHandles: readonly string[];
  listState: IntegrationResourceListViewState;
  visibleItems: readonly IntegrationConnectionResource[];
  isRefreshing: boolean;
  refreshErrorMessage: string | null;
  emptyMessage: string;
  onSearchChange: (nextValue: string) => void;
  onToggleHandle: (handle: string) => void;
  onRefresh: () => void;
  onBlur: () => void;
  onFocus: () => void;
};

function IntegrationResourceMessageSection(input: {
  message: string;
  tone: "default" | "destructive";
  detail?: string | undefined;
  children?: React.ReactNode;
}): React.JSX.Element {
  return (
    <div className="gap-1 p-3 flex flex-col">
      <p
        className={
          input.tone === "destructive"
            ? "text-destructive text-sm"
            : "text-muted-foreground text-sm"
        }
      >
        {input.message}
      </p>
      {input.detail === undefined ? null : (
        <p
          className={
            input.tone === "destructive"
              ? "text-destructive/80 text-sm"
              : "text-muted-foreground text-sm"
          }
        >
          {input.detail}
        </p>
      )}
      {input.children}
    </div>
  );
}

export function IntegrationResourceStringArrayWidgetView(
  props: IntegrationResourceStringArrayWidgetViewProps,
): React.JSX.Element {
  const viewModel = buildIntegrationResourceWidgetViewModel({
    title: undefined,
    availableCount: undefined,
    refreshLabel: props.refreshLabel,
    syncMetadata: null,
    syncState: undefined,
    emptyMessage: props.emptyMessage,
    search: props.search,
    selectedCount: props.selectedHandles.length,
    refreshErrorMessage: props.refreshErrorMessage,
    unavailableSelectedHandles: props.unavailableSelectedHandles,
    unavailableSelectedHandlesCount: props.unavailableSelectedHandles.length,
    listState:
      props.listState.mode === "ready"
        ? { mode: "ready" }
        : props.listState.mode === "loading"
          ? { mode: "loading" }
          : { mode: "error", message: props.listState.message },
    visibleItemsCount: props.visibleItems.length,
  });

  return (
    <div className="gap-3 flex flex-col">
      <div className="gap-2 flex items-center">
        <Input
          aria-label={props.label}
          className="w-full"
          id={props.id}
          onBlur={props.onBlur}
          onChange={(event) => {
            props.onSearchChange(event.currentTarget.value);
          }}
          onFocus={props.onFocus}
          placeholder={props.searchPlaceholder}
          value={props.search}
        />
        <Button
          aria-label={props.refreshLabel}
          disabled={props.isRefreshing}
          onClick={props.onRefresh}
          size="icon-sm"
          title={props.refreshTooltip}
          type="button"
          variant="outline"
        >
          <ArrowClockwiseIcon
            aria-hidden
            className={props.isRefreshing ? "size-4 animate-spin" : "size-4"}
          />
        </Button>
      </div>
      {viewModel.messageSections.length > 0 ? (
        <div className="overflow-hidden rounded-md border">
          <div className="divide-y">
            {viewModel.messageSections.map((section) => (
              <IntegrationResourceMessageSection
                detail={section.detail}
                key={`${section.tone}:${section.message}`}
                message={section.message}
                tone={section.tone}
              >
                {section.items === undefined ? null : (
                  <ul className="text-destructive/80 list-disc pl-5 text-sm">
                    {section.items.map((item) => (
                      <li key={item}>{item}</li>
                    ))}
                  </ul>
                )}
              </IntegrationResourceMessageSection>
            ))}
          </div>
        </div>
      ) : null}

      {viewModel.hasVisibleItems ? (
        <div className="overflow-hidden rounded-md border">
          {viewModel.selectedCountLabel === null ? null : (
            <div className="text-muted-foreground border-b px-3 py-2 text-xs">
              {viewModel.selectedCountLabel}
            </div>
          )}
          <ScrollArea className="h-56">
            {props.visibleItems.map((resource) => {
              const isSelected = props.selectedHandles.includes(resource.handle);

              return (
                <label
                  className="hover:bg-muted/40 gap-3 flex cursor-pointer items-start p-3"
                  key={resource.id}
                >
                  <input
                    checked={isSelected}
                    className="mt-0.5"
                    onChange={() => {
                      props.onToggleHandle(resource.handle);
                    }}
                    type="checkbox"
                  />
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-medium text-sm">{resource.handle}</div>
                  </div>
                </label>
              );
            })}
          </ScrollArea>
        </div>
      ) : null}
    </div>
  );
}
