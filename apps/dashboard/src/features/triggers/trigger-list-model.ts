import type { TriggerListItemViewModel } from "./trigger-list-types.js";

type TriggerListFilterOption = {
  value: string;
  label: string;
};

function defineTriggerListFilterOptions<const TOptions extends readonly TriggerListFilterOption[]>(
  options: TOptions,
): TOptions {
  return options;
}

export const TRIGGER_LIST_FILTER_OPTIONS = defineTriggerListFilterOptions([
  { value: "all", label: "All" },
  { value: "enabled", label: "Enabled" },
  { value: "disabled", label: "Disabled" },
  { value: "events", label: "Events" },
  { value: "schedules", label: "Schedules" },
]);

export type TriggerListFilter = (typeof TRIGGER_LIST_FILTER_OPTIONS)[number]["value"];

export function toTriggerListFilter(value: string | null): TriggerListFilter {
  if (value === null) {
    throw new Error("Trigger filter value must not be null.");
  }

  const matchingOption = TRIGGER_LIST_FILTER_OPTIONS.find(
    (filterOption) => filterOption.value === value,
  );
  if (matchingOption !== undefined) {
    return matchingOption.value;
  }

  throw new Error(`Unexpected trigger filter value: "${value}".`);
}

function normalizeSearch(value: string): string {
  return value.trim().toLocaleLowerCase();
}

function includesSearchValue(value: string | null, searchValue: string): boolean {
  return value !== null && value.toLocaleLowerCase().includes(searchValue);
}

function matchesFilter(item: TriggerListItemViewModel, filter: TriggerListFilter): boolean {
  switch (filter) {
    case "all":
      return true;
    case "enabled":
      return item.enabled;
    case "disabled":
      return !item.enabled;
    case "events":
      return item.source.kind === "webhook";
    case "schedules":
      return item.source.kind === "schedule";
  }
}

function matchesSourceSearch(item: TriggerListItemViewModel, searchValue: string): boolean {
  if (item.source.kind === "webhook") {
    return item.source.events.some((event) => includesSearchValue(event.label, searchValue));
  }

  return (
    includesSearchValue(item.source.cronExpression, searchValue) ||
    includesSearchValue(item.source.timezone, searchValue) ||
    includesSearchValue(item.source.nextScheduledAtLabel, searchValue)
  );
}

export function filterTriggerListItems(input: {
  items: readonly TriggerListItemViewModel[];
  filter: TriggerListFilter;
  search: string;
}): TriggerListItemViewModel[] {
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
