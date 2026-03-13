import { Input, Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@mistle/ui";
import { MagnifyingGlassIcon } from "@phosphor-icons/react";

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
      <div className="relative w-full sm:w-72 md:w-[22rem]">
        <MagnifyingGlassIcon
          aria-hidden
          className="text-muted-foreground pointer-events-none absolute top-1/2 left-3 size-5 -translate-y-1/2"
        />
        <Input
          aria-label={input.searchAriaLabel}
          className="h-10 pr-2 pl-10"
          onChange={(event) => input.onSearchValueChange(event.target.value)}
          placeholder={input.searchPlaceholder}
          value={input.searchValue}
        />
      </div>

      <Select
        onValueChange={(nextValue) => {
          if (nextValue === null) {
            throw new Error("List search filter toolbar value must not be null.");
          }

          input.onFilterValueChange(nextValue);
        }}
        value={input.filterValue}
      >
        <SelectTrigger
          aria-label={input.filterAriaLabel}
          className={input.filterTriggerClassName ?? "h-10 w-24"}
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
