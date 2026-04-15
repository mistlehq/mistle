import { ToolbarSearchInput } from "../../shared/toolbar-search-input.js";
import type { MembersDirectoryFilter } from "./members-api.js";

export function MembersDirectoryToolbar(input: {
  activeFilter: MembersDirectoryFilter;
  searchValue: string;
  onSearchValueChange: (nextValue: string) => void;
}): React.JSX.Element {
  return (
    <ToolbarSearchInput
      ariaLabel="Search"
      onValueChange={input.onSearchValueChange}
      placeholder="Search"
      value={input.searchValue}
    />
  );
}
