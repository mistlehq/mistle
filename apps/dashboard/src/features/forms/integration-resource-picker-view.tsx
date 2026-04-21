import {
  Button,
  Combobox,
  ComboboxChips,
  ComboboxChipsInput,
  ComboboxContent,
  ComboboxItem,
  ComboboxList,
  Notice,
  useComboboxAnchor,
} from "@mistle/ui";
import { ArrowClockwiseIcon } from "@phosphor-icons/react";
import { useCallback, useState } from "react";

import type { IntegrationConnectionResource } from "../integrations/integrations-service.js";
import {
  buildIntegrationResourcePickerViewModel,
  type IntegrationResourceListViewState,
} from "./integration-resource-picker-view-model.js";

export type IntegrationResourcePickerViewProps = {
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

function ResourceMessages(input: {
  viewModel: ReturnType<typeof buildIntegrationResourcePickerViewModel>;
  variant?: "default" | "alert";
}): React.JSX.Element | null {
  const messageSections =
    input.variant === undefined
      ? input.viewModel.messageSections
      : input.viewModel.messageSections.filter((section) => section.variant === input.variant);

  if (messageSections.length === 0) {
    return null;
  }

  return (
    <div className="flex flex-col gap-2">
      {messageSections.map((section) => (
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

function ComboboxLayout(input: {
  props: IntegrationResourcePickerViewProps;
  viewModel: ReturnType<typeof buildIntegrationResourcePickerViewModel>;
  allVisibleSelected: boolean;
  someVisibleSelected: boolean;
}): React.JSX.Element {
  const anchorRef = useComboboxAnchor();
  const [isOpen, setIsOpen] = useState(false);
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
      <div className="flex flex-col gap-2">
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
              placeholder={
                input.props.selectedHandles.length === 0 ? input.props.searchPlaceholder : ""
              }
            />
          </ComboboxChips>
        </div>
        <ResourceMessages variant="alert" viewModel={input.viewModel} />
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
            <ResourceMessages variant="default" viewModel={input.viewModel} />
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

export function IntegrationResourcePickerView(
  props: IntegrationResourcePickerViewProps,
): React.JSX.Element {
  const viewModel = buildIntegrationResourcePickerViewModel({
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

  return (
    <ComboboxLayout
      allVisibleSelected={allVisibleSelected}
      props={props}
      someVisibleSelected={someVisibleSelected}
      viewModel={viewModel}
    />
  );
}
