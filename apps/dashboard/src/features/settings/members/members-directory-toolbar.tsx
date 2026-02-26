import { Input, Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@mistle/ui";
import { MagnifyingGlassIcon } from "@phosphor-icons/react";

import {
  formatMembersDirectoryTableFilter,
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
    <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
      <div className="relative w-full sm:w-80 md:w-[26rem]">
        <MagnifyingGlassIcon
          aria-hidden
          className="text-muted-foreground pointer-events-none absolute top-1/2 left-3 size-5 -translate-y-1/2"
        />
        <Input
          aria-label="Search members and invitations"
          className="h-10 pr-2 pl-10"
          onChange={(event) => input.onSearchValueChange(event.target.value)}
          placeholder="Search members or invitations"
          value={input.searchValue}
        />
      </div>

      <Select
        onValueChange={(nextValue) =>
          input.onFilterChange(toMembersDirectoryTableFilter(nextValue))
        }
        value={input.activeFilter}
      >
        <SelectTrigger aria-label="Filter directory rows" className="h-10 w-24">
          <SelectValue placeholder="Filter">
            {formatMembersDirectoryTableFilter(input.activeFilter)}
          </SelectValue>
        </SelectTrigger>
        <SelectContent>
          {MEMBERS_DIRECTORY_TABLE_FILTER_OPTIONS.map((filterOption) => (
            <SelectItem key={filterOption.value} value={filterOption.value}>
              {filterOption.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
