import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@mistle/ui";

import { resolveSelectableValue } from "./select-value.js";
import { ToolbarSearchInput } from "./toolbar-search-input.js";

export type ListSearchFilterToolbarOption = {
  value: string;
  label: string;
};

function getFilterLabel(input: {
  filterOptions: ReadonlyArray<ListSearchFilterToolbarOption>;
  filterValue: string;
}): string {
  return (
    input.filterOptions.find((filterOption) => filterOption.value === input.filterValue)?.label ??
    "Filter"
  );
}

export function ListSearchFilterToolbar(input: {
  searchValue: string;
  searchAriaLabel: string;
  searchPlaceholder: string;
  onSearchValueChange: (nextValue: string) => void;
  filterValue: string;
  filterAriaLabel: string;
  filterOptions: ReadonlyArray<ListSearchFilterToolbarOption>;
  onFilterValueChange: (nextValue: string) => void;
  filterTriggerClassName?: string;
}): React.JSX.Element {
  return (
    <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
      <ToolbarSearchInput
        ariaLabel={input.searchAriaLabel}
        onValueChange={input.onSearchValueChange}
        placeholder={input.searchPlaceholder}
        value={input.searchValue}
      />

      <Select
        onValueChange={(nextValue) => {
          if (nextValue === null) {
            return;
          }

          input.onFilterValueChange(nextValue);
        }}
        value={resolveSelectableValue({
          selectedValue: input.filterValue,
          optionValues: input.filterOptions.map((filterOption) => filterOption.value),
        })}
      >
        <SelectTrigger
          aria-label={input.filterAriaLabel}
          className={input.filterTriggerClassName ?? "w-24"}
        >
          <SelectValue placeholder="Filter">
            {getFilterLabel({
              filterOptions: input.filterOptions,
              filterValue: input.filterValue,
            })}
          </SelectValue>
        </SelectTrigger>
        <SelectContent>
          {input.filterOptions.map((filterOption) => (
            <SelectItem key={filterOption.value} value={filterOption.value}>
              {filterOption.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
