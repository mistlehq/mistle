import { formatRelativeOrDate } from "../shared/date-formatters.js";

export function formatAutomationUpdatedAt(isoDateTime: string): string {
  return formatRelativeOrDate(isoDateTime);
}

export function formatWebhookAutomationUpdatedAt(isoDateTime: string): string {
  return formatAutomationUpdatedAt(isoDateTime);
}
