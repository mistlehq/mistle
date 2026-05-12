import type { AutomationListEvent } from "./automations-types.js";

export function buildEventSummaryTitle(events: readonly AutomationListEvent[]): string {
  return events
    .map((event) => `${event.label}${event.unavailable === true ? " (Unavailable)" : ""}`)
    .join(", ");
}

export function resolveEventSummary(input: { events: readonly AutomationListEvent[] }): {
  firstEvent: AutomationListEvent | null;
  remainingCount: number;
  title: string;
} {
  const [firstEvent, ...remainingEvents] = input.events;

  return {
    firstEvent: firstEvent ?? null,
    remainingCount: remainingEvents.length,
    title: buildEventSummaryTitle(input.events),
  };
}
