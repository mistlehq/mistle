import type { WebhookAutomationListItemViewModel } from "./webhook-automation-list-types.js";

export type WebhookAutomationListFilter = "all" | "enabled" | "disabled";

export const WEBHOOK_AUTOMATION_LIST_FILTER_OPTIONS: ReadonlyArray<{
  value: WebhookAutomationListFilter;
  label: string;
}> = [
  { value: "all", label: "All" },
  { value: "enabled", label: "Enabled" },
  { value: "disabled", label: "Disabled" },
];

const WEBHOOK_AUTOMATION_LIST_FILTER_LABELS: Record<WebhookAutomationListFilter, string> = {
  all: "All",
  enabled: "Enabled",
  disabled: "Disabled",
};

function assertNever(value: never): never {
  throw new Error(`Unexpected value: ${String(value)}`);
}

export function formatWebhookAutomationListFilter(value: WebhookAutomationListFilter): string {
  return WEBHOOK_AUTOMATION_LIST_FILTER_LABELS[value];
}

export function toWebhookAutomationListFilter(value: string | null): WebhookAutomationListFilter {
  if (value === null) {
    throw new Error("Webhook automation filter value must not be null.");
  }

  if (value === "all" || value === "enabled" || value === "disabled") {
    return value;
  }

  throw new Error(`Unexpected webhook automation filter value: "${value}".`);
}

function normalizeSearch(value: string): string {
  return value.trim().toLocaleLowerCase();
}

function includesSearchValue(value: string, searchValue: string): boolean {
  return value.toLocaleLowerCase().includes(searchValue);
}

function matchesFilter(
  item: WebhookAutomationListItemViewModel,
  filter: WebhookAutomationListFilter,
): boolean {
  switch (filter) {
    case "all":
      return true;
    case "enabled":
      return item.enabled;
    case "disabled":
      return !item.enabled;
    default:
      return assertNever(filter);
  }
}

export function filterWebhookAutomationListItems(input: {
  items: readonly WebhookAutomationListItemViewModel[];
  filter: WebhookAutomationListFilter;
  search: string;
}): WebhookAutomationListItemViewModel[] {
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
      includesSearchValue(item.targetName, searchValue) ||
      item.events.some((event) => includesSearchValue(event.label, searchValue)) ||
      includesSearchValue(item.enabled ? "enabled" : "disabled", searchValue)
    );
  });
}
