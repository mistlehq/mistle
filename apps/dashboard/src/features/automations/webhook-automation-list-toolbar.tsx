import { ListSearchFilterToolbar } from "../shared/list-search-filter-toolbar.js";
import {
  toWebhookAutomationListFilter,
  WEBHOOK_AUTOMATION_LIST_FILTER_OPTIONS,
  type WebhookAutomationListFilter,
} from "./webhook-automation-list-model.js";

export function WebhookAutomationListToolbar(input: {
  activeFilter: WebhookAutomationListFilter;
  searchValue: string;
  onSearchValueChange: (nextValue: string) => void;
  onFilterChange: (nextValue: WebhookAutomationListFilter) => void;
}): React.JSX.Element {
  return (
    <ListSearchFilterToolbar
      filterAriaLabel="Filter automations"
      filterOptions={WEBHOOK_AUTOMATION_LIST_FILTER_OPTIONS}
      filterTriggerClassName="h-10 w-28"
      filterValue={input.activeFilter}
      onFilterValueChange={(nextValue) =>
        input.onFilterChange(toWebhookAutomationListFilter(nextValue))
      }
      onSearchValueChange={input.onSearchValueChange}
      searchAriaLabel="Search automations"
      searchPlaceholder="Search automations"
      searchValue={input.searchValue}
    />
  );
}
