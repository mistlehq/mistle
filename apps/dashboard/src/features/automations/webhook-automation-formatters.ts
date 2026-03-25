import { formatRelativeOrDate } from "../shared/date-formatters.js";

export function formatWebhookAutomationUpdatedAt(isoDateTime: string): string {
  return formatRelativeOrDate(isoDateTime);
}
