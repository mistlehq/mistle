import { ListSearchFilterToolbar } from "../shared/list-search-filter-toolbar.js";
import {
  TRIGGER_LIST_FILTER_OPTIONS,
  toTriggerListFilter,
  type TriggerListFilter,
} from "./trigger-list-model.js";

export function TriggerListToolbar(input: {
  activeFilter: TriggerListFilter;
  searchValue: string;
  onSearchValueChange: (nextValue: string) => void;
  onFilterChange: (nextValue: TriggerListFilter) => void;
}): React.JSX.Element {
  return (
    <ListSearchFilterToolbar
      filterAriaLabel="Filter triggers"
      filterOptions={TRIGGER_LIST_FILTER_OPTIONS}
      filterTriggerClassName="w-28"
      filterValue={input.activeFilter}
      onFilterValueChange={(nextValue) => input.onFilterChange(toTriggerListFilter(nextValue))}
      onSearchValueChange={input.onSearchValueChange}
      searchAriaLabel="Search triggers"
      searchPlaceholder="Search triggers, events, schedules, profiles, or repositories"
      searchValue={input.searchValue}
    />
  );
}
