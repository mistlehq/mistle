import { Input, Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@mistle/ui";
import { MagnifyingGlassIcon } from "@phosphor-icons/react";

import {
  formatWebhookAutomationListFilter,
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
    <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
      <div className="relative w-full sm:w-72 md:w-[22rem]">
        <MagnifyingGlassIcon
          aria-hidden
          className="text-muted-foreground pointer-events-none absolute top-1/2 left-3 size-5 -translate-y-1/2"
        />
        <Input
          aria-label="Search automations"
          className="h-10 pr-2 pl-10"
          onChange={(event) => input.onSearchValueChange(event.target.value)}
          placeholder="Search automations"
          value={input.searchValue}
        />
      </div>

      <Select
        onValueChange={(nextValue) =>
          input.onFilterChange(toWebhookAutomationListFilter(nextValue))
        }
        value={input.activeFilter}
      >
        <SelectTrigger aria-label="Filter automations" className="h-10 w-28">
          <SelectValue placeholder="Filter">
            {formatWebhookAutomationListFilter(input.activeFilter)}
          </SelectValue>
        </SelectTrigger>
        <SelectContent>
          {WEBHOOK_AUTOMATION_LIST_FILTER_OPTIONS.map((filterOption) => (
            <SelectItem key={filterOption.value} value={filterOption.value}>
              {filterOption.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
