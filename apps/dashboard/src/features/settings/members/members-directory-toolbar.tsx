import { ListSearchFilterToolbar } from "../../shared/list-search-filter-toolbar.js";
import {
  MEMBERS_DIRECTORY_TABLE_FILTER_OPTIONS,
  toMembersDirectoryTableFilter,
  type MembersDirectoryTableFilter,
} from "./members-directory-model.js";

export function MembersDirectoryToolbar(input: {
  activeFilter: MembersDirectoryTableFilter;
  searchValue: string;
  onSearchValueChange: (nextValue: string) => void;
  onFilterChange: (nextValue: MembersDirectoryTableFilter) => void;
}): React.JSX.Element {
  return (
    <ListSearchFilterToolbar
      filterAriaLabel="Filter directory rows"
      filterOptions={MEMBERS_DIRECTORY_TABLE_FILTER_OPTIONS}
      filterTriggerClassName="h-10 w-24"
      filterValue={input.activeFilter}
      onFilterValueChange={(nextValue) =>
        input.onFilterChange(toMembersDirectoryTableFilter(nextValue))
      }
      onSearchValueChange={input.onSearchValueChange}
      searchAriaLabel="Search members and invitations"
      searchPlaceholder="Search members or invitations"
      searchValue={input.searchValue}
    />
  );
}
