import { useState } from "react";

import {
  filterWebhookAutomationListItems,
  type WebhookAutomationListFilter,
} from "./webhook-automation-list-model.js";
import type { WebhookAutomationListItemViewModel } from "./webhook-automation-list-view.js";

export function useWebhookAutomationListState(input: {
  items: readonly WebhookAutomationListItemViewModel[];
}): {
  activeFilter: WebhookAutomationListFilter;
  setActiveFilter: (nextValue: WebhookAutomationListFilter) => void;
  searchValue: string;
  setSearchValue: (nextValue: string) => void;
  visibleItems: WebhookAutomationListItemViewModel[];
  hasItems: boolean;
} {
  const [activeFilter, setActiveFilter] = useState<WebhookAutomationListFilter>("all");
  const [searchValue, setSearchValue] = useState("");

  const visibleItems = filterWebhookAutomationListItems({
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
