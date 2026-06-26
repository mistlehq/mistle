import {
  Button,
  Combobox,
  ComboboxChip,
  ComboboxChips,
  ComboboxChipsInput,
  ComboboxContent,
  ComboboxItem,
  ComboboxList,
  FieldError,
  useComboboxAnchor,
} from "@mistle/ui";
import { ArrowClockwiseIcon } from "@phosphor-icons/react";
import { useCallback, useState } from "react";

import {
  buildIntegrationResourcePickerViewModel,
  type IntegrationResourceListViewState,
  type IntegrationResourcePickerViewModel,
} from "./integration-resource-picker-view-model.js";

export type IntegrationConnectionResourcePickerItem = {
  id: string;
  value: string;
  label: string;
};

export type IntegrationConnectionResourcePickerResource = {
  id: string;
  handle: string;
  displayName: string;
};

export type IntegrationConnectionResourcePickerDensity = "default" | "compact";

export type IntegrationConnectionResourcePickerViewProps = {
  density?: IntegrationConnectionResourcePickerDensity | undefined;
  id: string;
  label: string;
  resourceLabelPlural?: string | undefined;
  search: string;
  searchPlaceholder: string;
  refreshLabel: string;
  refreshTooltip: string;
  selectedValues: readonly string[];
  unavailableSelectedValues: readonly string[];
  listState: IntegrationResourceListViewState;
  visibleItems: readonly IntegrationConnectionResourcePickerItem[];
  isRefreshing: boolean;
  disabled?: boolean | undefined;
  refreshErrorMessage: string | null;
  emptyMessage: string;
  onSearchChange: (nextValue: string) => void;
  onSelectionChange: (nextValue: readonly string[]) => void;
  onRefresh: () => void;
  onBlur: () => void;
  onFocus: () => void;
};

export function toIntegrationConnectionResourcePickerItems(
  resources: readonly IntegrationConnectionResourcePickerResource[],
): IntegrationConnectionResourcePickerItem[] {
  return resources.map((resource) => ({
    id: resource.id,
    value: resource.handle,
    label: resource.displayName,
  }));
}

function IntegrationResourceMessageSection(input: {
  message: string;
  variant: "default" | "alert";
  detail?: string | undefined;
  items?: readonly string[] | undefined;
}): React.JSX.Element {
  if (input.variant === "alert") {
    return (
      <FieldError className="text-xs whitespace-nowrap">
        {formatCompactAlertMessage({
          detail: input.detail,
          items: input.items,
          message: input.message,
        })}
      </FieldError>
    );
  }

  return <p className="text-muted-foreground text-sm">{input.message}</p>;
}

function formatCompactAlertMessage(input: {
  message: string;
  detail: string | undefined;
  items: readonly string[] | undefined;
}): string {
  const messageWithDetail =
    input.detail === undefined ? input.message : `${input.message} ${input.detail}`;
  if (input.items === undefined || input.items.length === 0) {
    return messageWithDetail;
  }

  return `${messageWithDetail} ${input.items.join(", ")}`;
}

function ResourceMessages(input: {
  viewModel: IntegrationResourcePickerViewModel;
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
          items={section.items}
          key={`${section.variant}:${section.message}`}
          message={section.message}
          variant={section.variant}
        />
      ))}
    </div>
  );
}

function ComboboxLayout(input: {
  props: IntegrationConnectionResourcePickerViewProps;
  viewModel: IntegrationResourcePickerViewModel;
  allVisibleSelected: boolean;
  someVisibleSelected: boolean;
}): React.JSX.Element {
  const anchorRef = useComboboxAnchor();
  const [isOpen, setIsOpen] = useState(false);
  const density = input.props.density ?? "default";
  const selectAllRef = useCallback(
    (element: HTMLInputElement | null) => {
      if (element) {
        element.indeterminate = input.someVisibleSelected;
      }
    },
    [input.someVisibleSelected],
  );
  const itemLabelsByValue = new Map<string, string>();
  for (const item of input.props.visibleItems) {
    itemLabelsByValue.set(item.value, item.label);
  }
  const unavailableSelectedValueSet = new Set(input.props.unavailableSelectedValues);
  const chipsClassName = density === "compact" ? "min-h-10 w-full gap-1 px-2 py-1" : "w-full";
  const chipClassName = density === "compact" ? "h-6 max-w-full" : "max-w-full";
  const contentClassName = density === "compact" ? "w-[min(30rem,calc(100vw-2rem))] p-0" : "p-0";
  const listWrapperClassName =
    density === "compact" ? "max-h-64 overflow-y-auto p-2" : "max-h-72 overflow-y-auto p-2";
  const listClassName = density === "compact" ? "max-h-48" : "max-h-56";
  const hasVisibleItems = input.props.visibleItems.length > 0;
  const hasAlertMessages = input.viewModel.messageSections.some(
    (section) => section.variant === "alert",
  );

  function toggleAllVisibleItems(): void {
    const visibleValues = input.props.visibleItems.map((item) => item.value);
    const visibleValueSet = new Set(visibleValues);
    if (input.allVisibleSelected) {
      input.props.onSelectionChange(
        input.props.selectedValues.filter((value) => !visibleValueSet.has(value)),
      );
      return;
    }

    const selectedSet = new Set(input.props.selectedValues);
    const valuesToAdd = visibleValues.filter((value) => !selectedSet.has(value));
    input.props.onSelectionChange([...input.props.selectedValues, ...valuesToAdd]);
  }

  return (
    <Combobox<string, true>
      autoHighlight
      disabled={input.props.disabled === true}
      inputValue={input.props.search}
      multiple
      onInputValueChange={(nextValue) => {
        if (input.props.disabled === true) {
          return;
        }

        input.props.onSearchChange(nextValue);
      }}
      onOpenChange={(open) => {
        if (input.props.disabled === true) {
          setIsOpen(false);
          return;
        }

        setIsOpen(open);
        if (open) {
          input.props.onFocus();
          return;
        }

        input.props.onSearchChange("");
        input.props.onBlur();
      }}
      onValueChange={(value) => {
        if (input.props.disabled === true) {
          return;
        }

        input.props.onSelectionChange(value);
      }}
      open={isOpen}
      value={[...input.props.selectedValues]}
    >
      <div className="flex flex-col gap-2">
        <div ref={anchorRef}>
          <ComboboxChips
            className={chipsClassName}
            onClick={() => {
              if (input.props.disabled === true) {
                return;
              }

              setIsOpen(true);
            }}
          >
            {input.props.selectedValues.map((selectedValue) => {
              const isUnavailableSelected = unavailableSelectedValueSet.has(selectedValue);

              return (
                <ComboboxChip
                  className={chipClassName}
                  invalid={isUnavailableSelected}
                  key={selectedValue}
                >
                  <span className="truncate">
                    {itemLabelsByValue.get(selectedValue) ?? selectedValue}
                  </span>
                </ComboboxChip>
              );
            })}
            <ComboboxChipsInput
              aria-invalid={hasAlertMessages ? true : undefined}
              aria-label={input.props.label}
              className="min-w-28"
              disabled={input.props.disabled === true}
              id={input.props.id}
              onFocus={input.props.onFocus}
              placeholder={
                input.props.selectedValues.length === 0 ? input.props.searchPlaceholder : ""
              }
            />
          </ComboboxChips>
        </div>
        <ResourceMessages variant="alert" viewModel={input.viewModel} />
      </div>

      {isOpen ? (
        <ComboboxContent anchor={anchorRef} className={contentClassName}>
          <div className="border-b px-2 py-1.5">
            <div className="flex items-center justify-between gap-2">
              {hasVisibleItems ? (
                <label className="hover:bg-muted text-foreground inline-flex min-w-0 items-center gap-2 rounded-sm px-2 py-1 text-sm">
                  <input
                    checked={input.allVisibleSelected}
                    disabled={input.props.disabled === true}
                    onChange={() => {
                      toggleAllVisibleItems();
                    }}
                    ref={selectAllRef}
                    type="checkbox"
                  />
                  <span>Select all</span>
                </label>
              ) : (
                <span aria-hidden className="min-w-0" />
              )}
              <div className="flex items-center gap-2">
                {input.viewModel.selectedCountLabel === null ? null : (
                  <span className="text-muted-foreground shrink-0 text-xs">
                    {input.viewModel.selectedCountLabel}
                  </span>
                )}
                <Button
                  aria-label={input.props.refreshLabel}
                  disabled={input.props.disabled === true || input.props.isRefreshing}
                  onMouseDown={(event) => {
                    event.preventDefault();
                  }}
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
          <div className={listWrapperClassName}>
            {hasVisibleItems ? (
              <ResourceMessages variant="default" viewModel={input.viewModel} />
            ) : null}
            <ComboboxList className={listClassName}>
              {input.props.visibleItems.map((resource) => (
                <ComboboxItem key={resource.id} value={resource.value}>
                  <span className="truncate">{resource.label}</span>
                </ComboboxItem>
              ))}
            </ComboboxList>
            {!hasVisibleItems ? (
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

export function IntegrationConnectionResourcePickerView(
  props: IntegrationConnectionResourcePickerViewProps,
): React.JSX.Element {
  const viewModel = buildIntegrationResourcePickerViewModel({
    title: undefined,
    availableCount: undefined,
    resourceLabelPlural: props.resourceLabelPlural,
    refreshLabel: props.refreshLabel,
    syncMetadata: null,
    syncState: undefined,
    emptyMessage: props.emptyMessage,
    search: props.search,
    selectedCount: props.selectedValues.length,
    refreshErrorMessage: props.refreshErrorMessage,
    unavailableSelectedHandles: props.unavailableSelectedValues,
    listState: props.listState,
    visibleItemsCount: props.visibleItems.length,
  });

  const selectedSet = new Set(props.selectedValues);
  const allVisibleSelected =
    props.visibleItems.length > 0 &&
    props.visibleItems.every((item) => selectedSet.has(item.value));
  const someVisibleSelected =
    !allVisibleSelected && props.visibleItems.some((item) => selectedSet.has(item.value));

  return (
    <ComboboxLayout
      allVisibleSelected={allVisibleSelected}
      props={props}
      someVisibleSelected={someVisibleSelected}
      viewModel={viewModel}
    />
  );
}
