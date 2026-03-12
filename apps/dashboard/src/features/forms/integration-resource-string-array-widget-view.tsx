import { Button, Input, ScrollArea } from "@mistle/ui";
import { ArrowClockwiseIcon } from "@phosphor-icons/react";

import type { IntegrationConnectionResource } from "../integrations/integrations-service.js";

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
      items: readonly IntegrationConnectionResource[];
    };

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
  const hasVisibleItems = props.visibleItems.length > 0;

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
      {props.refreshErrorMessage === null &&
      props.unavailableSelectedHandles.length === 0 &&
      (hasVisibleItems || props.listState.mode === "loading") ? null : (
        <div className="overflow-hidden rounded-md border">
          <div className="divide-y">
            {props.refreshErrorMessage === null ? null : (
              <IntegrationResourceMessageSection
                detail="Please try again."
                message="Refresh failed."
                tone="destructive"
              />
            )}

            {props.unavailableSelectedHandles.length === 0 ? null : (
              <IntegrationResourceMessageSection
                message="The selected resources are no longer available:"
                tone="destructive"
              >
                <ul className="text-destructive/80 list-disc pl-5 text-sm">
                  {props.unavailableSelectedHandles.map((handle) => (
                    <li key={handle}>{handle}</li>
                  ))}
                </ul>
              </IntegrationResourceMessageSection>
            )}

            {props.listState.mode === "error" ? (
              <IntegrationResourceMessageSection
                detail="Try again. If this keeps failing, reconnect the integration."
                message="Sync failed. Only showing last synced results."
                tone="destructive"
              />
            ) : props.visibleItems.length === 0 ? (
              <IntegrationResourceMessageSection message={props.emptyMessage} tone="default" />
            ) : null}
          </div>
        </div>
      )}

      {hasVisibleItems ? (
        <ScrollArea className="h-56 overflow-hidden rounded-md border">
          <div className="divide-y">
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
          </div>
        </ScrollArea>
      ) : null}
    </div>
  );
}
