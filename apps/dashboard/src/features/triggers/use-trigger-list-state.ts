import { useState } from "react";

import { filterTriggerListItems, type TriggerListFilter } from "./trigger-list-model.js";
import type { TriggerListItemViewModel } from "./trigger-list-types.js";

export function useTriggerListState(input: { items: readonly TriggerListItemViewModel[] }): {
  activeFilter: TriggerListFilter;
  setActiveFilter: (nextValue: TriggerListFilter) => void;
  searchValue: string;
  setSearchValue: (nextValue: string) => void;
  visibleItems: TriggerListItemViewModel[];
  hasItems: boolean;
} {
  const [activeFilter, setActiveFilter] = useState<TriggerListFilter>("all");
  const [searchValue, setSearchValue] = useState("");

  const visibleItems = filterTriggerListItems({
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
