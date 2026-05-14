import { ListSearchFilterToolbar } from "../shared/list-search-filter-toolbar.js";
import {
  AUTOMATION_LIST_FILTER_OPTIONS,
  toAutomationListFilter,
  type AutomationListFilter,
} from "./automation-list-model.js";

export function AutomationListToolbar(input: {
  activeFilter: AutomationListFilter;
  searchValue: string;
  onSearchValueChange: (nextValue: string) => void;
  onFilterChange: (nextValue: AutomationListFilter) => void;
}): React.JSX.Element {
  return (
    <ListSearchFilterToolbar
      filterAriaLabel="Filter triggers"
      filterOptions={AUTOMATION_LIST_FILTER_OPTIONS}
      filterTriggerClassName="w-28"
      filterValue={input.activeFilter}
      onFilterValueChange={(nextValue) => input.onFilterChange(toAutomationListFilter(nextValue))}
      onSearchValueChange={input.onSearchValueChange}
      searchAriaLabel="Search triggers"
      searchPlaceholder="Search triggers, events, schedules, profiles, or repositories"
      searchValue={input.searchValue}
    />
  );
}
