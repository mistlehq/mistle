import type { AutomationListItemViewModel } from "./automation-list-types.js";

export type AutomationListFilter = "all" | "enabled" | "disabled";

export const AUTOMATION_LIST_FILTER_OPTIONS: ReadonlyArray<{
  value: AutomationListFilter;
  label: string;
}> = [
  { value: "all", label: "All" },
  { value: "enabled", label: "Enabled" },
  { value: "disabled", label: "Disabled" },
];

export function toAutomationListFilter(value: string | null): AutomationListFilter {
  if (value === null) {
    throw new Error("Trigger filter value must not be null.");
  }

  if (value === "all" || value === "enabled" || value === "disabled") {
    return value;
  }

  throw new Error(`Unexpected trigger filter value: "${value}".`);
}

function normalizeSearch(value: string): string {
  return value.trim().toLocaleLowerCase();
}

function includesSearchValue(value: string | null, searchValue: string): boolean {
  return value !== null && value.toLocaleLowerCase().includes(searchValue);
}

function matchesFilter(item: AutomationListItemViewModel, filter: AutomationListFilter): boolean {
  switch (filter) {
    case "all":
      return true;
    case "enabled":
      return item.enabled;
    case "disabled":
      return !item.enabled;
  }
}

function matchesSourceSearch(item: AutomationListItemViewModel, searchValue: string): boolean {
  if (item.source.kind === "webhook") {
    return item.source.events.some((event) => includesSearchValue(event.label, searchValue));
  }

  return (
    includesSearchValue(item.source.cronExpression, searchValue) ||
    includesSearchValue(item.source.timezone, searchValue) ||
    includesSearchValue(item.source.nextScheduledAtLabel, searchValue)
  );
}

export function filterAutomationListItems(input: {
  items: readonly AutomationListItemViewModel[];
  filter: AutomationListFilter;
  search: string;
}): AutomationListItemViewModel[] {
  const searchValue = normalizeSearch(input.search);

  return input.items.filter((item) => {
    if (!matchesFilter(item, input.filter)) {
      return false;
    }

    if (searchValue.length === 0) {
      return true;
    }

    return (
      includesSearchValue(item.name, searchValue) ||
      includesSearchValue(item.kind === "schedule" ? "schedule" : "trigger", searchValue) ||
      includesSearchValue(item.target.sandboxProfileName, searchValue) ||
      includesSearchValue(item.target.sandboxProfileId, searchValue) ||
      includesSearchValue(item.target.primaryRepositoryName, searchValue) ||
      includesSearchValue(item.target.primaryRepositoryId, searchValue) ||
      includesSearchValue(item.enabled ? "enabled" : "disabled", searchValue) ||
      matchesSourceSearch(item, searchValue)
    );
  });
}
