import {
  Button,
  Combobox,
  ComboboxChips,
  ComboboxChipsInput,
  ComboboxContent,
  ComboboxItem,
  ComboboxList,
  Notice,
  ScrollArea,
  useComboboxAnchor,
} from "@mistle/ui";
import { ArrowClockwiseIcon } from "@phosphor-icons/react";
import { useCallback, useState } from "react";

import type { IntegrationConnectionResource } from "../integrations/integrations-service.js";
import {
  buildIntegrationResourceWidgetViewModel,
  type IntegrationResourceListViewState,
} from "./integration-resource-string-array-widget-view-model.js";

export type IntegrationResourceStringArrayWidgetViewProps = {
  id: string;
  label: string;
  layoutVariant: "panel" | "combobox";
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
  onSelectionChange: (nextValue: readonly string[]) => void;
  onToggleAll: () => void;
  onRefresh: () => void;
  onBlur: () => void;
  onFocus: () => void;
};

function IntegrationResourceMessageSection(input: {
  message: string;
  variant: "default" | "alert";
  detail?: string | undefined;
  children?: React.ReactNode;
}): React.JSX.Element {
  return (
    <Notice title={input.message} variant={input.variant}>
      <div className="flex flex-col gap-1">
        {input.detail === undefined ? null : <p>{input.detail}</p>}
        {input.children}
      </div>
    </Notice>
  );
}

function SelectAllRow(input: {
  allVisibleSelected: boolean;
  someVisibleSelected: boolean;
  selectedCountLabel: string | null;
  onToggleAll: () => void;
}): React.JSX.Element {
  const indeterminateRef = useCallback(
    (element: HTMLInputElement | null) => {
      if (element) {
        element.indeterminate = input.someVisibleSelected;
      }
    },
    [input.someVisibleSelected],
  );

  return (
    <label className="hover:bg-muted/40 border-b gap-3 flex items-center p-3 select-none">
      <input
        checked={input.allVisibleSelected}
        onChange={input.onToggleAll}
        ref={indeterminateRef}
        type="checkbox"
      />
      <div className="min-w-0 flex-1">
        <div className="truncate font-medium text-sm">Select all</div>
      </div>
      {input.selectedCountLabel === null ? null : (
        <span className="text-muted-foreground shrink-0 text-xs">{input.selectedCountLabel}</span>
      )}
    </label>
  );
}

function ResourceMessages(input: {
  viewModel: ReturnType<typeof buildIntegrationResourceWidgetViewModel>;
}): React.JSX.Element | null {
  if (input.viewModel.messageSections.length === 0) {
    return null;
  }

  return (
    <div className="flex flex-col gap-2">
      {input.viewModel.messageSections.map((section) => (
        <IntegrationResourceMessageSection
          detail={section.detail}
          key={`${section.variant}:${section.message}`}
          message={section.message}
          variant={section.variant}
        >
          {section.items === undefined ? null : (
            <ul className="list-disc pl-5">
              {section.items.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          )}
        </IntegrationResourceMessageSection>
      ))}
    </div>
  );
}

function PanelLayout(input: {
  props: IntegrationResourceStringArrayWidgetViewProps;
  viewModel: ReturnType<typeof buildIntegrationResourceWidgetViewModel>;
  allVisibleSelected: boolean;
  someVisibleSelected: boolean;
}): React.JSX.Element {
  return (
    <div className="gap-3 flex flex-col">
      <div className="gap-2 flex items-center">
        <input
          aria-label={input.props.label}
          className="dark:bg-input/30 border-input focus-visible:border-ring focus-visible:ring-ring/50 flex h-9 w-full rounded-md border bg-transparent px-3 py-1 text-base shadow-xs transition-[color,box-shadow] outline-none focus-visible:ring-[3px] md:text-sm"
          id={input.props.id}
          onBlur={input.props.onBlur}
          onChange={(event) => {
            input.props.onSearchChange(event.currentTarget.value);
          }}
          onFocus={input.props.onFocus}
          placeholder={input.props.searchPlaceholder}
          value={input.props.search}
        />
        <Button
          aria-label={input.props.refreshLabel}
          disabled={input.props.isRefreshing}
          onClick={input.props.onRefresh}
          size="icon"
          title={input.props.refreshTooltip}
          type="button"
          variant="outline"
        >
          <ArrowClockwiseIcon
            aria-hidden
            className={input.props.isRefreshing ? "size-4 animate-spin" : "size-4"}
          />
        </Button>
      </div>
      <ResourceMessages viewModel={input.viewModel} />

      {input.viewModel.hasVisibleItems ? (
        <div className="overflow-hidden rounded-md border">
          <SelectAllRow
            allVisibleSelected={input.allVisibleSelected}
            someVisibleSelected={input.someVisibleSelected}
            selectedCountLabel={input.viewModel.selectedCountLabel}
            onToggleAll={input.props.onToggleAll}
          />
          <ScrollArea className="h-56">
            {input.props.visibleItems.map((resource) => {
              const isSelected = input.props.selectedHandles.includes(resource.handle);
              const nextValue = isSelected
                ? input.props.selectedHandles.filter((handle) => handle !== resource.handle)
                : [...input.props.selectedHandles, resource.handle];

              return (
                <label className="hover:bg-muted/40 gap-3 flex items-center p-3" key={resource.id}>
                  <input
                    checked={isSelected}
                    onChange={() => {
                      input.props.onSelectionChange(nextValue);
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

function ComboboxLayout(input: {
  props: IntegrationResourceStringArrayWidgetViewProps;
  viewModel: ReturnType<typeof buildIntegrationResourceWidgetViewModel>;
  allVisibleSelected: boolean;
  someVisibleSelected: boolean;
}): React.JSX.Element {
  const anchorRef = useComboboxAnchor();
  const [isOpen, setIsOpen] = useState(false);
  const comboboxMessageSections = input.viewModel.messageSections.filter(
    (section) => section.variant === "alert",
  );
  const selectAllRef = useCallback(
    (element: HTMLInputElement | null) => {
      if (element) {
        element.indeterminate = input.someVisibleSelected;
      }
    },
    [input.someVisibleSelected],
  );

  return (
    <Combobox<string, true>
      autoHighlight
      inputValue={input.props.search}
      multiple
      onInputValueChange={input.props.onSearchChange}
      onOpenChange={(open) => {
        setIsOpen(open);
        if (open) {
          input.props.onFocus();
          return;
        }

        input.props.onSearchChange("");
        input.props.onBlur();
      }}
      onValueChange={(value) => {
        input.props.onSelectionChange(value);
      }}
      open={isOpen}
      value={[...input.props.selectedHandles]}
    >
      <div ref={anchorRef}>
        <ComboboxChips
          className="w-full"
          onClick={() => {
            setIsOpen(true);
          }}
        >
          {input.props.selectedHandles.map((selectedHandle) => (
            <div
              className="bg-muted text-foreground flex h-[calc(--spacing(5.5))] max-w-full items-center rounded-sm px-1.5 text-xs font-medium"
              key={selectedHandle}
            >
              <span className="truncate">{selectedHandle}</span>
            </div>
          ))}
          <ComboboxChipsInput
            aria-label={input.props.label}
            className="min-w-28"
            id={input.props.id}
            onFocus={input.props.onFocus}
            placeholder={input.props.selectedHandles.length === 0 ? "Select repositories" : ""}
          />
        </ComboboxChips>
      </div>

      {isOpen ? (
        <ComboboxContent anchor={anchorRef} className="p-0">
          <div className="border-b px-2 py-1.5">
            <div className="flex items-center justify-between gap-2">
              <label className="hover:bg-muted text-foreground inline-flex min-w-0 items-center gap-2 rounded-sm px-2 py-1 text-sm">
                <input
                  checked={input.allVisibleSelected}
                  onChange={() => {
                    input.props.onToggleAll();
                  }}
                  ref={selectAllRef}
                  type="checkbox"
                />
                <span>Select all</span>
              </label>
              <div className="flex items-center gap-2">
                {input.viewModel.selectedCountLabel === null ? null : (
                  <span className="text-muted-foreground shrink-0 text-xs">
                    {input.viewModel.selectedCountLabel}
                  </span>
                )}
                <Button
                  aria-label={input.props.refreshLabel}
                  disabled={input.props.isRefreshing}
                  onClick={input.props.onRefresh}
                  size="icon-xs"
                  title={input.props.refreshTooltip}
                  type="button"
                  variant="ghost"
                >
                  <ArrowClockwiseIcon
                    aria-hidden
                    className={input.props.isRefreshing ? "size-4 animate-spin" : "size-4"}
                  />
                </Button>
              </div>
            </div>
          </div>
          <div className="max-h-72 overflow-y-auto p-2">
            {comboboxMessageSections.length > 0 ? (
              <div className="mb-2 flex flex-col gap-2">
                {comboboxMessageSections.map((section) => (
                  <IntegrationResourceMessageSection
                    detail={section.detail}
                    key={`${section.variant}:${section.message}`}
                    message={section.message}
                    variant={section.variant}
                  >
                    {section.items === undefined ? null : (
                      <ul className="list-disc pl-5">
                        {section.items.map((item) => (
                          <li key={item}>{item}</li>
                        ))}
                      </ul>
                    )}
                  </IntegrationResourceMessageSection>
                ))}
              </div>
            ) : null}
            <ComboboxList className="max-h-56">
              {input.props.visibleItems.map((resource) => (
                <ComboboxItem key={resource.id} value={resource.handle}>
                  <span className="truncate">{resource.handle}</span>
                </ComboboxItem>
              ))}
            </ComboboxList>
            {input.props.visibleItems.length === 0 ? (
              <div className="text-muted-foreground py-2 text-center text-sm">
                {input.viewModel.emptyMessage}
              </div>
            ) : null}
          </div>
        </ComboboxContent>
      ) : null}
    </Combobox>
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

  const selectedSet = new Set(props.selectedHandles);
  const allVisibleSelected =
    props.visibleItems.length > 0 &&
    props.visibleItems.every((item) => selectedSet.has(item.handle));
  const someVisibleSelected =
    !allVisibleSelected && props.visibleItems.some((item) => selectedSet.has(item.handle));

  if (props.layoutVariant === "combobox") {
    return (
      <ComboboxLayout
        allVisibleSelected={allVisibleSelected}
        props={props}
        someVisibleSelected={someVisibleSelected}
        viewModel={viewModel}
      />
    );
  }

  return (
    <PanelLayout
      allVisibleSelected={allVisibleSelected}
      props={props}
      someVisibleSelected={someVisibleSelected}
      viewModel={viewModel}
    />
  );
}
