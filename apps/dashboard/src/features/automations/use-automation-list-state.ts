import { useState } from "react";

import { filterAutomationListItems, type AutomationListFilter } from "./automation-list-model.js";
import type { AutomationListItemViewModel } from "./automation-list-types.js";

export function useAutomationListState(input: { items: readonly AutomationListItemViewModel[] }): {
  activeFilter: AutomationListFilter;
  setActiveFilter: (nextValue: AutomationListFilter) => void;
  searchValue: string;
  setSearchValue: (nextValue: string) => void;
  visibleItems: AutomationListItemViewModel[];
  hasItems: boolean;
} {
  const [activeFilter, setActiveFilter] = useState<AutomationListFilter>("all");
  const [searchValue, setSearchValue] = useState("");

  const visibleItems = filterAutomationListItems({
    items: input.items,
    filter: activeFilter,
    search: searchValue,
  });

  return {
    activeFilter,
    setActiveFilter,
    searchValue,
    setSearchValue,
    visibleItems,
    hasItems: input.items.length > 0,
  };
}
