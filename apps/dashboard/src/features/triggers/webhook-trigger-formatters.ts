import { formatRelativeOrDate } from "../shared/date-formatters.js";

export function formatTriggerUpdatedAt(isoDateTime: string): string {
  return formatRelativeOrDate(isoDateTime);
}

export function formatWebhookTriggerUpdatedAt(isoDateTime: string): string {
  return formatTriggerUpdatedAt(isoDateTime);
}
