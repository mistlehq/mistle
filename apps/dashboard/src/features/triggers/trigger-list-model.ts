import type { ListTriggersQuery } from "./triggers-types.js";

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

export type TriggerListServerFilters = Pick<ListTriggersQuery, "kind" | "enabled">;

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

export function toTriggerListServerFilters(filter: TriggerListFilter): TriggerListServerFilters {
  switch (filter) {
    case "all":
      return {};
    case "enabled":
      return { enabled: true };
    case "disabled":
      return { enabled: false };
    case "events":
      return { kind: "webhook" };
    case "schedules":
      return { kind: "schedule" };
  }
}

export function normalizeTriggerListSearch(search: string): string | undefined {
  const normalizedSearch = search.trim();
  return normalizedSearch.length === 0 ? undefined : normalizedSearch;
}
